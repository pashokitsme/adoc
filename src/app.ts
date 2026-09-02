// app.ts — argv агрегатора: разбор, выбор команды, сбор вывода. Сам ничего не
// печатает: строки копятся и уходят наружу одним куском, чтобы большой --json
// не обрезался на пайпе (см. sdk/out.ts) и чтобы run() был проверяем тестом.
// Единственное исключение — интерактивный `login`: его диалог идёт прямо в
// терминал, иначе подсказка «Пароль >» появилась бы после ввода пароля.

import { ProviderError, TOOL, errorBody, exitCode, parseArgv, red, renderBrands, yellow } from "./sdk/index.ts"
import type { Flags } from "./sdk/index.ts"
import { cmdAccounts, cmdLogin, cmdLogout } from "./commands/accounts.ts"
import { cmdPart } from "./commands/part.ts"
import { cmdProviders } from "./commands/providers.ts"
import { cmdSearch } from "./commands/search.ts"
import type { Ctx, Output } from "./core/ctx.ts"
import { Ambiguous } from "./core/errors.ts"
import type { MergedBrand } from "./core/merge.ts"
import { blame, failureLine } from "./core/partial.ts"
import { load, select, type Loaded } from "./core/registry.ts"
import { hint, whereCol } from "./core/render.ts"

// Флаги обёртки, которые берут значение. Булевы (--json, --analogs) сюда не
// входят: parseArgv развернёт их сам.
const VALUE_FLAGS = [
	"only", "providers", "skip", "limit", "page", "qty", "ref",
	"brand", "model", "modification", "year", "engine", "vin", "odometer",
]

type Handler = (ctx: Ctx) => Promise<Output>

// Таблица команд обёртки. Остальные имена — не ошибка разбора, а вопрос к
// самому провайдеру: `adoc armtek hello` появится в задаче 14.
const COMMANDS: Record<string, Handler> = {
	part: cmdPart,
	search: cmdSearch,
	providers: cmdProviders,
	accounts: cmdAccounts,
	whoami: cmdAccounts,
	login: cmdLogin,
	logout: cmdLogout,
}

const HELP = `adoc — поиск запчастей сразу по нескольким магазинам

  part <артикул> [бренд]     предложения всех сайтов одной таблицей
  search <текст>             поиск по названию
  reviews <артикул> [бренд]  оценки и отзывы
  basket [add|set|rm]        корзины всех сайтов
  garage [add|rm|main]       свой гараж, живёт локально
  login|logout <provider>    вход и выход у сайта
  accounts | whoami          кто авторизован
  providers                  какие сайты подключены
  <provider> <команда> …     команда самого сайта как есть

  --json  --only a,b  --skip a,b  --limit <n>  --page <n>  --analogs
`

export type RunResult = { stdout: string; stderr: string; code: number }

export async function run(argv: string[]): Promise<RunResult> {
	// Форма ответа зависит от --json, а разбор argv умеет падать: флаг ищем в
	// сыром argv, иначе ошибка разбора уехала бы машинному вызову текстом.
	const json = argv.some(a => a === "--json" || a === "--json=true")
	let stderr = ""
	const warn = (line: string): void => { stderr += line.endsWith("\n") ? line : `${line}\n` }

	try {
		const { args, flags } = parseArgv(argv, VALUE_FLAGS)
		const [name, ...rest] = args
		if (!name || flags.help) {
			// Машинному вызову справка бесполезна: он ждёт JSON и споткнулся бы
			// на разборе таблицы вместо внятной ошибки.
			if (json) {
				const why = flags.help ? "--help не отдаётся в JSON: список сайтов — providers --json" : "нужна команда: смотри --help"
				throw new ProviderError("bad_args", why)
			}
			return { stdout: HELP, stderr, code: 0 }
		}
		// Только собственные ключи: `adoc toString` иначе доставал бы из
		// прототипа объекта функцию и печатал бы «undefined» с кодом 0.
		const handler = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined
		// Остальные команды появятся в задачах 7–14.
		if (!handler) throw new ProviderError("bad_args", `неизвестная команда: ${name} — смотри adoc --help`)

		const out = await handler(makeCtx(rest, flags, json, warn))
		return { stdout: `${json ? JSON.stringify(out.json) : out.render()}\n`, stderr, code: out.code ?? 0 }
	} catch (e) {
		// Список вариантов, собранный из половины сайтов, — неполный список:
		// молчать про упавшего нельзя ни человеку, ни машине.
		if (e instanceof Ambiguous) for (const f of e.failures) warn(failureLine(f))
		// Код в теле и код возврата — из одного места, иначе текстовый и
		// машинный ответы разошлись бы.
		const body = errorBody(e)
		const code = exitCode(body.error.code)
		if (json) {
			const full = e instanceof Ambiguous ? { error: { ...body.error, extra: { errors: e.failures } } } : body
			return { stdout: `${JSON.stringify(full)}\n`, stderr, code }
		}
		// «Уточни бренд» — не ошибка, а список: человеку нужна таблица с
		// колонкой «где», а не одна строка красным.
		const table = e instanceof Ambiguous
			? `${renderBrands(e.brands, [whereCol<MergedBrand>()])}\n${hint(`повтори с брендом: ${TOOL} part <артикул> <бренд> или --brand <бренд>`)}\n`
			: ""
		return { stdout: "", stderr: `${stderr}${red(body.error.message)}\n${table}`, code }
	}
}

function makeCtx(args: string[], flags: Flags, json: boolean, warn: (line: string) => void): Ctx {
	// describe снимается один раз на запуск: `part` спрашивает провайдеров
	// дважды, а список их команд за время одной команды не меняется.
	let loaded: Promise<Loaded> | null = null
	let toldAboutBad = false
	const ctx: Ctx = {
		args, flags, json, warn,
		// Предупреждения и stderr от describe тоже принадлежат человеку.
		load: () => (loaded ??= load(warn)),
		pick: async (cap, opts) => {
			const l = await ctx.load()
			// Про сломанного провайдера говорим один раз за запуск, а не на
			// каждом вопросе к реестру. Имя приписывается тем же blame, что и
			// строкам отказа: правило подписи в обёртке одно.
			if (!toldAboutBad) {
				toldAboutBad = true
				for (const b of l.bad) warn(yellow(blame(b.id, `провайдер не отвечает по контракту — ${b.message}`)))
			}
			return select(l.ok, flags, cap, opts)
		},
	}
	return ctx
}

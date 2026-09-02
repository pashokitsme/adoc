// app.ts — argv агрегатора: разбор, выбор команды, сбор вывода. Сам ничего не
// печатает: строки копятся и уходят наружу одним куском, чтобы большой --json
// не обрезался на пайпе (см. sdk/out.ts) и чтобы run() был проверяем тестом.
// Единственное исключение — интерактивный `login`: его диалог идёт прямо в
// терминал, иначе подсказка «Пароль >» появилась бы после ввода пароля.

import { ProviderError, TOOL, errorBody, exitCode, parseArgv, red, renderBrands, yellow } from "./sdk/index.ts"
import type { Flags } from "./sdk/index.ts"
import { cmdAccounts, cmdLogin, cmdLogout } from "./commands/accounts.ts"
import { cmdBasket } from "./commands/basket.ts"
import { cmdGarage } from "./commands/garage.ts"
import { cmdPart } from "./commands/part.ts"
import { cmdProviders } from "./commands/providers.ts"
import { cmdReviews } from "./commands/reviews.ts"
import { cmdSearch } from "./commands/search.ts"
import type { Ctx, Output } from "./core/ctx.ts"
import { Ambiguous } from "./core/errors.ts"
import { VALUE_FLAGS, helpText } from "./core/help.ts"
import type { MergedBrand } from "./core/merge.ts"
import { blame, failureLine } from "./core/partial.ts"
import { discover, load, select, type Loaded } from "./core/registry.ts"
import { hint, linkList, numCol, whereCol } from "./core/render.ts"

type Handler = (ctx: Ctx) => Promise<Output>

// Таблица команд обёртки. Остальные имена — не ошибка разбора, а вопрос к
// самому провайдеру: `adoc armtek hello` разбирает commands/passthrough.ts.
const COMMANDS: Record<string, Handler> = {
	part: cmdPart,
	basket: cmdBasket,
	search: cmdSearch,
	reviews: cmdReviews,
	garage: cmdGarage,
	providers: cmdProviders,
	accounts: cmdAccounts,
	whoami: cmdAccounts,
	login: cmdLogin,
	logout: cmdLogout,
}

/**
 * Имена команд обёртки: их не отдаёт провайдеру проброс. `help` — такая же
 * команда, только её обрабатывает сам run(): это второе написание `--help`.
 */
export const COMMAND_NAMES = [...Object.keys(COMMANDS), "help"]

/** Команды, которые начинаются с шага «артикул → бренд» и умеют спросить «уточни». */
const BRAND_COMMANDS = new Set(["part", "reviews"])

export type RunResult = { stdout: string; stderr: string; code: number }

export async function run(argv: string[]): Promise<RunResult> {
	// Форма ответа зависит от --json, а разбор argv умеет падать: флаг ищем в
	// сыром argv, иначе ошибка разбора уехала бы машинному вызову текстом.
	const json = argv.some(a => a === "--json" || a === "--json=true")
	let stderr = ""
	// Имя команды нужно и обработчику ошибки: подсказка «повтори с брендом»
	// обязана звать ту команду, которую человек и набрал, а не всегда `part`.
	// До разбора argv его ещё нет — тогда и подсказка достанется `part`.
	let ran = "part"
	const warn = (line: string): void => { stderr += line.endsWith("\n") ? line : `${line}\n` }

	try {
		const { args, flags } = parseArgv(argv, VALUE_FLAGS)
		const [name, ...rest] = args
		if (name && BRAND_COMMANDS.has(name)) ran = name
		const ctx = makeCtx(rest, flags, json, warn)

		// `help` — то же слово без дефисов: проброс его провайдеру и так не
		// отдаёт, так что печатаем ту же справку, а не «неизвестную команду».
		const wantsHelp = flags.help === true || name === "help"
		if (!name || wantsHelp) {
			// Машинному вызову справка бесполезна: он ждёт JSON и споткнулся бы
			// на разборе таблицы вместо внятной ошибки. Список команд и сайтов
			// для машины даёт providers --json.
			if (json) {
				const why = wantsHelp
					? `--help не отдаётся в JSON: список команд и сайтов — ${TOOL} providers --json`
					: `нужна команда: смотри ${TOOL} --help или ${TOOL} providers --json`
				throw new ProviderError("bad_args", why)
			}
			// Реестр может упасть на битом PATH или на провайдере, который не
			// отвечает: справка про свои команды важнее его беды.
			let loaded: Loaded | null = null
			try {
				loaded = await ctx.load()
			} catch {
				// Ничего: без списка сайтов справка всё равно печатается.
			}
			return { stdout: `${helpText(loaded)}\n`, stderr, code: 0 }
		}
		// Только собственные ключи: `adoc toString` иначе доставал бы из
		// прототипа объекта функцию и печатал бы «undefined» с кодом 0.
		const handler = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined
		// Сюда доходит только то, что не забрал проброс: значит, ни команды
		// обёртки, ни сайта с таким именем нет. Перечисляем оба списка — чаще
		// всего это опечатка ровно в одном из них.
		if (!handler) {
			const ids = (await discover()).map(p => p.id)
			throw new ProviderError("bad_args", `неизвестная команда: ${name} — команды: ${COMMAND_NAMES.join(", ")}; сайты: ${ids.join(", ") || "ни одного"}`)
		}

		const out = await handler(ctx)
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
			? `${[
				renderBrands(e.brands, [numCol(e.brands), whereCol<MergedBrand>()]),
				...linkList(e.brands),
				"",
				hint(`повтори с брендом: ${TOOL} ${ran} <артикул> <бренд> или --brand <бренд>`),
			].join("\n")}\n`
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

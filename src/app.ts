// app.ts — argv агрегатора: разбор, выбор команды, сбор вывода. Сам ничего не
// печатает: строки копятся и уходят наружу одним куском, чтобы большой --json
// не обрезался на пайпе (см. sdk/out.ts) и чтобы run() был проверяем тестом.
// Единственное исключение — интерактивный `login`: его диалог идёт прямо в
// терминал, иначе подсказка «Пароль >» появилась бы после ввода пароля.

import { ProviderError, errorBody, exitCode, parseArgv, red } from "./sdk/index.ts"

// Флаги обёртки, которые берут значение. Булевы (--json, --analogs) сюда не
// входят: parseArgv развернёт их сам.
const VALUE_FLAGS = [
	"only", "providers", "skip", "limit", "page", "qty", "ref",
	"brand", "model", "modification", "year", "engine", "vin", "odometer",
]

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
		const name = args[0]
		if (!name || flags.help) {
			// Машинному вызову справка бесполезна: он ждёт JSON и споткнулся бы
			// на разборе таблицы вместо внятной ошибки.
			if (json) {
				const why = flags.help ? "--help не отдаётся в JSON: список сайтов — providers --json" : "нужна команда: смотри --help"
				throw new ProviderError("bad_args", why)
			}
			return { stdout: HELP, stderr, code: 0 }
		}
		// Команды появляются в задачах 6–14; до тех пор известных имён нет.
		throw new ProviderError("bad_args", `неизвестная команда: ${name} — смотри adoc --help`)
	} catch (e) {
		// Код в теле и код возврата — из одного места, иначе текстовый и
		// машинный ответы разошлись бы.
		const body = errorBody(e)
		const code = exitCode(body.error.code)
		if (json) return { stdout: `${JSON.stringify(body)}\n`, stderr, code }
		return { stdout: "", stderr: `${stderr}${red(body.error.message)}\n`, code }
	}
}

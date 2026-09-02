// help.ts — справка обёртки. Свои команды и флаги перечислены здесь, а строка
// про каждый сайт собирается из его describe: обёртка не знает заранее, какие
// провайдеры установлены и что они умеют, и врать об этом не должна.
//
// Таблица флагов тут одна и та же и для справки, и для разбора argv
// (VALUE_FLAGS): подвал справки уже расходился со списком флагов парсера, и
// разойтись снова он теперь не может.

import { TOOL, bold, dim } from "../sdk/index.ts"
import type { Loaded } from "./registry.ts"

type Row = { usage: string; about: string }

/**
 * Формы адресных команд корзины: их же печатает подсказкой `basket`, поэтому
 * строка живёт в одном месте, а не в двух почти одинаковых.
 */
export const BASKET_SET = "basket set <provider> <id>|--id <id> --qty <n>"
export const BASKET_RM = "basket rm <provider> <id>|--id <id>"

const COMMANDS: Row[] = [
	{ usage: "part <артикул>[,…] [бренд]", about: "предложения всех сайтов одной таблицей" },
	{ usage: "info <артикул> [бренд]", about: "карточка артикула: цена, срок, оценка, склады, ссылка" },
	{ usage: "analogs <артикул>[,…] [бренд]", about: "замены по номеру одной таблицей со всех сайтов" },
	{ usage: "crosses <артикул> [бренд]", about: "кросс-ссылки: оригиналы, замены, состав узла" },
	{ usage: "fits <артикул> [бренд]", about: "подойдёт ли деталь машине гаража: по строке на сайт" },
	{ usage: "search <текст>", about: "поиск по названию, по умолчанию — под машину из гаража" },
	{ usage: "reviews <артикул> [бренд]", about: "оценки и отзывы всех сайтов, где они есть" },
	{ usage: "basket", about: "корзины всех сайтов, итог по каждому и общий" },
	{ usage: "basket add <#> [--qty <n>]", about: "положить строку из последнего part" },
	{ usage: "basket add <provider> --ref <json> [--qty <n>]", about: "то же с явным ref из part --json" },
	{ usage: BASKET_SET, about: "изменить количество" },
	{ usage: BASKET_RM, about: "убрать позицию" },
	{ usage: "orders [--prices]", about: "заказы всех сайтов; --prices — сегодняшняя цена позиций" },
	{ usage: "garage", about: "свой гараж, ★ — основная машина" },
	{ usage: "garage add --brand … --model … [--modification --year --vin --engine --odometer]", about: "завести машину руками" },
	{ usage: "garage import <provider>", about: "забрать машины с сайта, слияние по VIN" },
	{ usage: "garage main <id> | rm <id>", about: "основная / удалить" },
	{ usage: "login | logout <provider>", about: "вход у сайта / забыть аккаунт" },
	{ usage: "accounts | whoami [provider]", about: "кто авторизован, у всех сайтов сразу" },
	{ usage: "providers", about: "какие сайты подключены и что умеют" },
	{ usage: "<provider> <команда> …", about: "команда самого сайта как есть" },
	{ usage: "help | --help", about: "эта справка" },
]

/**
 * Флаг обёртки. `value` — подпись значения: он же и признак «флаг со
 * значением» для parseArgv, булевы флаги его не имеют. `about` есть не у всех:
 * поля `garage add` перечислены в строке самой команды, и вторым списком в
 * подвале они бы только повторялись.
 */
type Flag = { name: string; alias?: string; value?: string; about?: string }

const FLAGS: Flag[] = [
	{ name: "json", about: "один JSON-объект в stdout вместо таблиц" },
	{ name: "quiet", about: "без предупреждений в stderr; то же, что ADOC_NO_WARN=1 (кратко -q)" },
	{ name: "only", alias: "providers", value: "a,b", about: "спрашивать только эти сайты" },
	{ name: "skip", value: "a,b", about: "пропустить эти" },
	{ name: "limit", value: "<n>", about: "сколько строк показывать, по умолчанию 30" },
	{ name: "page", value: "<n>", about: "страница выдачи у search и reviews" },
	{ name: "analogs", about: "добавить блок аналогов в part" },
	{ name: "prices", about: "у orders: спросить сегодняшнюю цену каждой позиции (колонки СЕЙЧАС и Δ)" },
	{ name: "car", value: "<id>", about: "машина гаража для search, по умолчанию основная" },
	{ name: "no-car", about: "искать без машины" },
	{ name: "brand", value: "<имя>", about: "бренд вместо второго слова: part, info, analogs, reviews" },
	{ name: "file", value: "<путь>", about: "список артикулов файлом для part и analogs: «артикул [бренд]» построчно" },
	{ name: "qty", value: "<n>", about: "количество для basket add и basket set" },
	{ name: "ref", value: "<json>", about: "предложение из part --json для basket add" },
	{ name: "id", value: "<id>", about: "позиция корзины, когда её ID похож на флаг" },
	{ name: "model", value: "<имя>" },
	{ name: "modification", value: "<имя>" },
	{ name: "year", value: "<n>" },
	{ name: "engine", value: "<имя>" },
	{ name: "vin", value: "<vin>" },
	{ name: "odometer", value: "<км>" },
]

/**
 * Флаги, которые берут значение: `--page --json` иначе съел бы `--json` как
 * номер страницы. Остальные parseArgv развернёт как булевы.
 */
export const VALUE_FLAGS: string[] = FLAGS.filter(f => f.value).flatMap(f => (f.alias ? [f.name, f.alias] : [f.name]))

const flagRow = (f: Flag): Row => ({
	usage: `--${f.name}${f.value ? ` ${f.value}` : ""}${f.alias ? ` | --${f.alias}${f.value ? ` ${f.value}` : ""}` : ""}`,
	about: f.about ?? "",
})

// Ширина колонки считается по обычным строкам: одна длинная форма (`basket add`
// с --ref) не должна отодвигать описания всех остальных к правому краю.
const COL = 30
// Строка шире этого — описание уезжает вниз: перенос терминалом посреди
// колонки читается хуже, чем честный перевод строки.
const WRAP = 88

function lines(rows: Row[], width: number): string[] {
	return rows.flatMap(r => {
		const head = `  ${r.usage.padEnd(width)}`
		if (head.length + 2 + r.about.length <= WRAP) return [`${head}  ${r.about}`]
		return [`  ${r.usage}`, `${" ".repeat(width + 2)}  ${r.about}`]
	})
}

export function helpText(loaded: Loaded | null): string {
	const flagRows = FLAGS.filter(f => f.about).map(flagRow)
	const width = Math.max(...[...COMMANDS, ...flagRows].map(r => (r.usage.length <= COL ? r.usage.length : 0)))
	const out = [
		`${bold(TOOL)} — цены, сроки и отзывы по артикулу сразу в нескольких магазинах`,
		"",
		...lines(COMMANDS, width),
		"",
		...lines(flagRows, width),
	]

	// Справка обязана печататься даже когда провайдеров нет или реестр упал:
	// без неё пользователь не узнает, как это чинить.
	if (loaded) {
		out.push("", bold("Сайты"))
		for (const p of loaded.ok) {
			const caps = p.describe.capabilities.length ? dim(`  умеет: ${p.describe.capabilities.join(", ")}`) : ""
			out.push(`  ${p.id.padEnd(12)}${p.describe.name} · ${p.describe.site}${caps}`)
		}
		// Сломанный провайдер — тоже часть ответа на вопрос «что у меня есть»:
		// молча выкинуть его из справки значит спрятать причину, по которой он
		// не отвечает.
		for (const b of loaded.bad) out.push(`  ${b.id.padEnd(12)}${dim(`не отвечает по контракту: ${b.message}`)}`)
		if (!loaded.ok.length && !loaded.bad.length) out.push(dim(`  ни одного не нашлось — положить исполняемый ${TOOL}-<id> в PATH`))
		out.push("", dim(`  ${TOOL} <сайт> --help — команды самого сайта`))
	}
	return out.join("\n")
}

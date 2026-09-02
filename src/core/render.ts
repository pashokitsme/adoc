// render.ts — то, что рисует только обёртка: свои таблицы (сайты, аккаунты),
// свои колонки к чужим таблицам (ПРОВАЙДЕР, ГДЕ, гараж) и подписи под ними.
// Сами таблицы выдачи рисует sdk/render.ts: у обёртки и у провайдера одни и
// те же колонки обязаны выглядеть одинаково, второго рендера в проекте нет.

import { TOOL, bold, dim, green, red, table, yellow } from "../sdk/index.ts"
import type { Col, Display } from "../sdk/index.ts"
import type { Garage, GarageCar } from "./garage.ts"
import type { OfferRow } from "./merge.ts"
import type { BadProvider, Provider } from "./registry.ts"

/** Подсказка под таблицей: что делать дальше. */
export const hint = (s: string): string => dim(s)

/** Блок подсказок: пустая строка перед ними одна на всех, а не на каждую. */
export const tips = (lines: string[]): string[] => (lines.length ? ["", ...lines.map(hint)] : [])

/**
 * Путь к бинарю в колонку. Установленный провайдер — это короткий
 * `/usr/local/bin/adoc-armtek`, а запущенный из исходников тянет за собой весь
 * путь до рабочего каталога и растягивает таблицу вдвое. В глаза нужен хвост:
 * по нему и видно, какой именно файл запускается. Целиком путь никуда не
 * девается — он в `providers --json`.
 */
function shortPath(path: string): string {
	const home = process.env.HOME
	const p = home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
	if (p.length <= 40) return p
	const parts = p.split("/")
	return parts.length > 4 ? `…/${parts.slice(-3).join("/")}` : p
}

/** Команда запуска: первое слово — сам бинарь или интерпретатор, дальше пути. */
const runsBy = (bin: string[]): string => bin.map(shortPath).join(" ")

export function providersTable(ok: Provider[], bad: BadProvider[], accounts: Set<string>): string {
	if (!ok.length && !bad.length) return `провайдеров не нашлось: положи исполняемый ${TOOL}-<id> в PATH`
	const rows = ok.map(p => [
		bold(p.id), p.describe.name, String(p.describe.contract),
		p.describe.capabilities.join(", ") || dim("—"),
		accounts.has(p.id) ? green("есть") : dim("нет"),
		dim(runsBy(p.bin)),
	])
	// Сломанный провайдер остаётся в списке: его id в своей колонке, поэтому
	// сообщение печатается как есть — имя рядом, второй раз не нужно.
	for (const b of bad) rows.push([red(b.id), red(b.message), dim("—"), dim("—"), dim("—"), dim(runsBy(b.bin))])
	return table(rows, ["ID", "ИМЯ", "КОНТРАКТ", "УМЕЕТ", "АККАУНТ", "ЧЕМ ЗАПУСКАЕТСЯ"])
}

export type AccountRow = { provider: string; ok: boolean; display?: Display; note?: string }

/**
 * Имя, почта и телефон печатаются как отдал сайт, без маскировки: это личные
 * данные самого пользователя, он их и видит. Дальше терминала они не идут.
 */
export function accountsTable(rows: AccountRow[]): string {
	if (!rows.length) return "аккаунтов нет"
	return table(rows.map(r => [
		bold(r.provider),
		r.note ? yellow(r.note) : r.ok ? green("вход есть") : dim("входа нет"),
		r.display?.name ?? dim("—"), r.display?.email ?? dim("—"), r.display?.phone ?? dim("—"),
	]), ["ПРОВАЙДЕР", "СТАТУС", "ИМЯ", "EMAIL", "ТЕЛЕФОН"])
}

/** Колонка «ПРОВАЙДЕР»: в таблице обёртки строки приходят из разных мест. */
export const providerCol: Col<OfferRow> = { head: "ПРОВАЙДЕР", cell: o => dim(o.provider) }

/** Колонка «ГДЕ»: у каких сайтов есть эта строка. */
export const whereCol = <T extends { providers: string[] }>(): Col<T> =>
	({ head: "ГДЕ", cell: x => dim(x.providers.join(", ")) })

/**
 * «показано X из Y» под таблицей. Y — то, что обёртка склеила из ответов;
 * `site` — сколько их у сайтов всего, если они это сказали. Числа разные:
 * armtek отдаёт страницу из 43 аналогов, а всего их 575, и молчать про
 * остальные значит соврать про размер выдачи. Строки нет, когда обрезать было
 * нечего. Список, а не строка, — чтобы вызывающий не проверял пустоту.
 */
export function cut(shown: number, total: number, site?: number): string[] {
	const more = total > shown
	const siteMore = site !== undefined && site > total
	if (!more && !siteMore) return []
	const head = `показано ${shown} из ${total}`
	return [hint(siteMore ? `${head}, а всего у сайтов ${site} — --limit <n> и --page <n>` : `${head} — --limit <n>`)]
}

/** ★ — основная машина; «СВЯЗИ» — сайты, откуда машина импортирована. */
export const garageCols = (g: Garage): Col<GarageCar>[] => [
	{ head: "ID", cell: c => `${g.mainId === c.id ? yellow("★") : " "}${c.id}` },
	{ head: "СВЯЗИ", cell: c => dim(Object.keys(c.refs ?? {}).join(", ")) },
]

/**
 * Склеенная строка: у одного товара своя страница на каждом сайте, где он
 * нашёлся. Первая уезжает в список адресов под таблицей (его печатает рендер
 * SDK), а остальным места там нет — они идут следом блоком «ещё ссылки».
 */
export type Linked = { url?: string; urls?: Record<string, string> }

/**
 * Адреса, которых нет в списке под таблицей. Рендер SDK печатает по одному
 * адресу на строку — тот, что лежит в `url`, — а склеенная строка живёт сразу
 * на нескольких сайтах. Здесь идут остальные, с именем сайта: без него
 * непонятно, куда ведёт вторая ссылка. Номера и отступы — те же, что у
 * urlList из SDK: два блока подряд не должны выглядеть по-разному.
 */
export function extraLinks(items: Linked[], from = 1): string[] {
	const rows: string[][] = []
	items.forEach((it, i) => {
		for (const [who, url] of Object.entries(it.urls ?? {})) {
			if (url && url !== it.url) rows.push([String(from + i), dim(who), dim(url)])
		}
	})
	// Подпись обязательна: без неё второй список номеров под первым читается
	// как продолжение той же нумерации, а это другие адреса других сайтов.
	return rows.length ? ["", dim("ещё ссылки"), table(rows)] : []
}

/**
 * Заголовок блока сайта: имя и о чём блок. Цвет внутри жирного не ставится —
 * bold закрылся бы на первой же вложенной последовательности, и половина
 * заголовка шла бы обычной. Адрес самой страницы печатает рендер SDK.
 */
export const blockTitle = (id: string, rest = ""): string => bold(`${id}${rest ? ` ${rest}` : ""}`)

// render.ts — то, что рисует только обёртка: свои таблицы (сайты, аккаунты),
// свои колонки к чужим таблицам (ПРОВАЙДЕР, ГДЕ, гараж) и подписи под ними.
// Сами таблицы выдачи рисует sdk/render.ts: у обёртки и у провайдера одни и
// те же колонки обязаны выглядеть одинаково, второго рендера в проекте нет.

import { TOOL, bold, brandKey, dim, green, hyperlink, linksMode, red, table, yellow } from "../sdk/index.ts"
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
	if (!ok.length && !bad.length) return `провайдеров не нашлось: положить исполняемый ${TOOL}-<id> в PATH`
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

/**
 * Склеенная строка: у одного товара своя страница на каждом сайте, где он
 * нашёлся. Первая уезжает в список адресов под таблицей (его печатает рендер
 * SDK), а остальным места там нет — они идут следом блоком «ещё ссылки».
 */
export type Linked = { url?: string; urls?: Record<string, string> }

/**
 * Имя сайта, кликабельное в режиме osc8: адрес — страница этой самой строки у
 * него. Так вторые и третьи адреса склеенной строки живут прямо в её колонке,
 * а не отдельным списком под таблицей.
 */
const siteLink = (x: Linked, id: string): string => {
	const url = x.urls?.[id]
	return url && linksMode() === "osc8" ? hyperlink(id, url) : id
}

/** Колонка «ПРОВАЙДЕР»: в таблице обёртки строки приходят из разных мест. */
export const providerCol: Col<OfferRow> = {
	head: "ПРОВАЙДЕР",
	cell: o => dim(o.url && linksMode() === "osc8" ? hyperlink(o.provider, o.url) : o.provider),
}

/** Колонка «ГДЕ»: у каких сайтов есть эта строка. */
export const whereCol = <T extends Linked & { providers: string[] }>(): Col<T> =>
	({ head: "ГДЕ", cell: x => dim(x.providers.map(id => siteLink(x, id)).join(", ")) })

/**
 * «показано X из Y» под таблицей. Y — то, что обёртка склеила из ответов;
 * `site` — сколько их у сайтов всего, если они это сказали. Числа разные:
 * armtek отдаёт страницу из 43 аналогов, а всего их 575, и молчать про
 * остальные значит соврать про размер выдачи. Строки нет, когда обрезать было
 * нечего. Список, а не строка, — чтобы вызывающий не проверял пустоту.
 */
export function cut(shown: number, total: number, site?: number): string[] {
	// Обрезала обёртка (--limit) и обрезали сайты (страница) — разные новости,
	// и советы у них разные: в первом случае поможет --limit, во втором --page.
	const more = total > shown
	const siteMore = site !== undefined && site > shown
	if (!more && !siteMore) return []
	if (more && siteMore) return [hint(`показано ${shown} из ${total}, а всего у сайтов ${site} — --limit <n> и --page <n>`)]
	if (more) return [hint(`показано ${shown} из ${total} — --limit <n>`)]
	return [hint(`показано ${shown}, всего у сайтов ${site} — --page <n>`)]
}

/**
 * Пометка «номер делят несколько брендов». У armtek один и тот же номер носят
 * товары разных производителей — под 900355 лежат и пыльник SACHS, и моторное
 * масло SINTEC, — и название строки само по себе ни о чём не говорит, пока не
 * видно, что номер общий. Показывается только когда брендов и правда больше
 * одного, чтобы не пугать там, где номер уникален.
 */
export function sharedNumber(brands: { brand: string }[], chosen: string): string[] {
	const others = brands.map(b => b.brand).filter(b => brandKey(b) !== brandKey(chosen))
	if (!others.length) return []
	return [hint(`номер делят ${brands.length} бренда(ов): ещё ${others.join(", ")} — название смотреть у своего`)]
}

/** ★ — основная машина; «СВЯЗИ» — сайты, откуда машина импортирована. */
export const garageCols = (g: Garage): Col<GarageCar>[] => [
	{ head: "ID", cell: c => `${g.mainId === c.id ? yellow("★") : " "}${c.id}` },
	{ head: "СВЯЗИ", cell: c => dim(Object.keys(c.refs ?? {}).join(", ")) },
]

/**
 * Заголовок блока сайта: имя и о чём блок. Цвет внутри жирного не ставится —
 * bold закрылся бы на первой же вложенной последовательности, и половина
 * заголовка шла бы обычной. Адрес самой страницы печатает рендер SDK.
 */
export const blockTitle = (id: string, rest = ""): string => bold(`${id}${rest ? ` ${rest}` : ""}`)

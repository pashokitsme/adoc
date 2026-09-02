// render.ts — таблицы агрегатора. Примитивы (table, money, days, звёзды,
// цвета, ячейки рейтинга и наличия) берутся из sdk/render.ts: у обёртки и у
// провайдера одни и те же колонки должны выглядеть одинаково.

import { TOOL, bar, bold, cyan, days, dim, fields, fold, green, isoDate, money, qtyCell, red, stars, table, yellow } from "../sdk/index.ts"
import type { Col, Display } from "../sdk/index.ts"
import type { Info, Order } from "./delta.ts"
import type { Garage, GarageCar } from "./garage.ts"
import type { OfferRow } from "./merge.ts"
import type { BadProvider, Provider } from "./registry.ts"

/** Подсказка под таблицей: что делать дальше. */
export const hint = (s: string): string => dim(s)

/** Блок подсказок: пустая строка перед ними одна на всех, а не на каждую. */
export const tips = (lines: string[]): string[] => (lines.length ? ["", ...lines.map(hint)] : [])

export function providersTable(ok: Provider[], bad: BadProvider[], accounts: Set<string>): string {
	if (!ok.length && !bad.length) return `провайдеров не нашлось: положи исполняемый ${TOOL}-<id> в PATH`
	const rows = ok.map(p => [
		bold(p.id), p.describe.name, String(p.describe.contract),
		p.describe.capabilities.join(", ") || dim("—"),
		accounts.has(p.id) ? green("есть") : dim("нет"),
		dim(p.bin.join(" ")),
	])
	// Сломанный провайдер остаётся в списке: его id в своей колонке, поэтому
	// сообщение печатается как есть — имя рядом, второй раз не нужно.
	for (const b of bad) rows.push([red(b.id), red(b.message), dim("—"), dim("—"), dim("—"), dim(b.bin.join(" "))])
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
 * «показано X из Y» под таблицей: строка появляется, только когда --limit
 * что-то отрезал. Возвращается списком, чтобы вызывающий не проверял пустоту.
 */
export const cut = (shown: number, total: number): string[] =>
	(total > shown ? [hint(`показано ${shown} из ${total} — --limit <n>`)] : [])

/** ★ — основная машина; «СВЯЗИ» — сайты, откуда машина импортирована. */
export const garageCols = (g: Garage): Col<GarageCar>[] => [
	{ head: "ID", cell: c => `${g.mainId === c.id ? yellow("★") : " "}${c.id}` },
	{ head: "СВЯЗИ", cell: c => dim(Object.keys(c.refs ?? {}).join(", ")) },
]

/**
 * Строка, у которой есть страница на сайте. `urls` — для склеенных строк:
 * один и тот же товар у двух сайтов лежит на двух разных страницах, и обе
 * человеку нужны.
 */
export type Linked = { url?: string; urls?: Record<string, string> }

/**
 * Ссылки строк — списком под таблицей, а не колонкой в ней. Адрес карточки
 * длиной с полстроки терминала разорвал бы вёрстку на каждой строке, а
 * обрезанный URL бесполезен: по нему не открыть страницу, ради которой всё и
 * затевалось. Номер слева — тот же номер, что в колонке «#».
 */
export function linkList(items: Linked[], from = 1, label = "ссылки"): string[] {
	const rows: [n: string, who: string, url: string][] = []
	items.forEach((it, i) => {
		const own = it.urls && Object.keys(it.urls).length ? Object.entries(it.urls) : it.url ? [["", it.url]] : []
		for (const [who, url] of own) rows.push([String(from + i), who ?? "", url ?? ""])
	})
	if (!rows.length) return []
	// Колонки выравниваются так же, как в самой таблице: разъехавшийся столбик
	// адресов читается хуже, чем один лишний пробел.
	const nw = Math.max(...rows.map(r => r[0].length))
	const ww = Math.max(...rows.map(r => r[1].length))
	return ["", dim(label), ...rows.map(([n, who, url]) => `  ${dim(n.padStart(nw))}  ${ww ? `${dim(who.padEnd(ww))}  ` : ""}${url}`)]
}

/**
 * Колонка «#» там, где рендер SDK её не рисует (поиск, список брендов):
 * без номера строке нечего сопоставить в списке ссылок под таблицей. Номер
 * берётся позицией в самом списке, а не счётчиком вызовов: счётчик соврал бы,
 * посчитай таблица ячейку дважды.
 */
export const numCol = <T>(items: T[], from = 1): Col<T> =>
	({ head: "#", cell: x => String(items.indexOf(x) + from) })

/**
 * Заголовок блока сайта: имя, о чём блок и адрес самой страницы. Цвет внутри
 * жирного не ставится — bold закрылся бы на первой же вложенной
 * последовательности, и половина заголовка шла бы обычной.
 */
export const blockTitle = (id: string, rest = "", url?: string): string =>
	`${bold(`${id}${rest ? ` ${rest}` : ""}`)}${url ? dim(`  ${url}`) : ""}`

/**
 * Карточка артикула одного сайта. Пустые поля не печатаются: строка «срок —»
 * ничего не сообщает, а карточку из четырёх прочерков читать неприятно.
 * Адреса тут нет — он стоит в заголовке блока (blockTitle), и второй раз тем
 * же самым URL карточку раздувать незачем.
 */
export function infoCard(info: Info): string {
	const rows: [string, string][] = [["название", info.name || dim("—")]]
	if (info.price !== undefined) rows.push(["цена от", money(info.price)])
	if (info.deliveryDays !== undefined) rows.push(["срок", days(info.deliveryDays)])
	if (info.rating) rows.push(["оценка", `${stars(info.rating.average)}  ${bold(info.rating.average.toFixed(2))}  ${dim(`${info.rating.count} оценок`)}`])
	const out = [fields(rows)]
	// Гистограмма — продолжение строки «оценка», но пустая строка перед ней
	// нужна: иначе она читается как ещё одно поле карточки.
	const hist = bar(info.rating?.histogram)
	if (hist.length) out.push("", ...hist)
	if (info.stock?.length) {
		// Таблица складов — часть карточки, и отступ у неё тот же, что у полей.
		const st = table(info.stock.map(x => [x.code, x.name ?? dim("—"), qtyCell(x.quantity)]), ["СКЛАД", "НАЗВАНИЕ", "НАЛИЧИЕ"])
		out.push("", st.split("\n").map(l => `  ${l}`).join("\n"))
	}
	if (info.description) out.push("", fold(info.description))
	return out.join("\n")
}

/** Заказы одного сайта. Что внутри заказа — на его странице, ссылка ниже. */
export function ordersTable(items: Order[]): string {
	if (!items.length) return "заказов нет"
	return table(items.map((o, i) => [
		String(i + 1), cyan(o.id), isoDate(o.date) ?? dim("—"), o.status || dim("—"),
		o.items?.length ? `${o.items.length}` : dim("—"), money(o.total),
	]), ["#", "НОМЕР", "ДАТА", "СТАТУС", "ПОЗИЦИЙ", "СУММА"])
}

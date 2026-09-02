// render.ts — таблицы агрегатора. Примитивы (table, money, days, звёзды,
// цвета, ячейки рейтинга и наличия) берутся из sdk/render.ts: у обёртки и у
// провайдера одни и те же колонки должны выглядеть одинаково.

import { TOOL, bold, dim, green, red, table, yellow } from "../sdk/index.ts"
import type { Col, Display } from "../sdk/index.ts"
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
 * Склеенная строка: у одного товара своя страница на каждом сайте, где он
 * нашёлся. Первая уезжает в колонку ССЫЛКА самой таблицы (рендер SDK), а
 * остальные печатать больше негде — они идут блоком под таблицей.
 */
export type Linked = { url?: string; urls?: Record<string, string> }

/**
 * Адреса, которых нет в таблице: колонка ССЫЛКА показывает один, а строка
 * `search` или «уточни бренд» может лежать на двух сайтах сразу. Номер слева —
 * тот же номер, что в колонке «#». Строк нет — блока нет.
 */
export function extraLinks(items: Linked[], from = 1): string[] {
	const rows: [n: string, who: string, url: string][] = []
	items.forEach((it, i) => {
		for (const [who, url] of Object.entries(it.urls ?? {})) {
			if (url && url !== it.url) rows.push([String(from + i), who, url])
		}
	})
	if (!rows.length) return []
	// Колонки выравниваются так же, как в самой таблице: разъехавшийся столбик
	// адресов читается хуже, чем один лишний пробел.
	const nw = Math.max(...rows.map(r => r[0].length))
	const ww = Math.max(...rows.map(r => r[1].length))
	return ["", dim("ещё ссылки"), ...rows.map(([n, who, url]) => `  ${dim(n.padStart(nw))}  ${dim(who.padEnd(ww))}  ${dim(url)}`)]
}

/**
 * Колонка «#» там, где рендер SDK её не рисует (поиск, список брендов):
 * без номера строке нечего сопоставить в блоке «ещё ссылки». Номер берётся
 * позицией в самом списке, а не счётчиком вызовов: счётчик соврал бы,
 * посчитай таблица ячейку дважды.
 */
export const numCol = <T>(items: T[], from = 1): Col<T> =>
	({ head: "#", cell: x => String(items.indexOf(x) + from) })

/**
 * Заголовок блока сайта: имя и о чём блок. Цвет внутри жирного не ставится —
 * bold закрылся бы на первой же вложенной последовательности, и половина
 * заголовка шла бы обычной. Адрес самой страницы печатает рендер SDK.
 */
export const blockTitle = (id: string, rest = ""): string => bold(`${id}${rest ? ` ${rest}` : ""}`)

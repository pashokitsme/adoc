// render.ts — таблицы агрегатора. Примитивы (table, money, days, звёзды,
// цвета, ячейки рейтинга и наличия) берутся из sdk/render.ts: у обёртки и у
// провайдера одни и те же колонки должны выглядеть одинаково.

import { TOOL, bold, dim, green, red, table, yellow } from "../sdk/index.ts"
import type { Col, Display } from "../sdk/index.ts"
import type { OfferRow } from "./merge.ts"
import type { BadProvider, Provider } from "./registry.ts"

/** Подсказка под таблицей: что делать дальше. */
export const hint = (s: string): string => dim(s)

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

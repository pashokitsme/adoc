// lastpart.ts — последняя выдача `part`. Нужна ровно для одного: чтобы
// `adoc basket add 3` знал, что было третьей строкой и у какого сайта.
// Кэш живёт сутки: цена и срок протухают, а положить в корзину вчерашнюю
// цену — обмануть пользователя молча.

import { ProviderError, TOOL } from "../sdk/index.ts"
import type { OfferRow } from "./merge.ts"
import { readJson, writeJson } from "./store.ts"

export const LAST_PART_FILE = "last-part.json"
export const MAX_AGE_MS = 24 * 60 * 60 * 1000

export type LastPartLine = {
	provider: string
	article: string
	brand: string
	name?: string
	price: number
	/** Непрозрачный объект сайта: уходит обратно в `basket add --ref` как есть. */
	ref?: Record<string, unknown>
}

export type LastPart = { article: string; brand: string; at: string; lines: LastPartLine[] }

/**
 * Строки сохраняются ровно в том порядке, в каком их показала таблица:
 * номер в кэше и номер под глазами человека — одно и то же число.
 */
export async function saveLastPart(article: string, brand: string, rows: OfferRow[]): Promise<void> {
	const lines: LastPartLine[] = rows.map(o => ({
		provider: o.provider, article: o.article, brand: o.brand, price: o.price,
		...(o.name ? { name: o.name } : {}), ...(o.ref ? { ref: o.ref } : {}),
	}))
	const data: LastPart = { article, brand, at: new Date().toISOString(), lines }
	await writeJson(LAST_PART_FILE, data)
}

/** Строка `n` из последней выдачи. Нумерация — с единицы, как в таблице. */
export async function lineOf(n: number, now: number = Date.now()): Promise<LastPartLine> {
	const lp = await readJson<LastPart>(LAST_PART_FILE)
	if (!lp?.lines?.length) throw new ProviderError("bad_args", `нет сохранённой выдачи — сначала ${TOOL} part <артикул>`)
	const age = now - Date.parse(lp.at)
	if (!Number.isFinite(age) || age > MAX_AGE_MS) throw new ProviderError("bad_args", `выдача старше суток — повтори ${TOOL} part ${lp.article} ${lp.brand}`)
	const line = lp.lines[n - 1]
	if (!line) throw new ProviderError("bad_args", `в последней выдаче ${lp.lines.length} строк(и), а спросили ${n}`)
	// Без ref сайт не примет позицию в корзину: честный отказ лучше, чем
	// `basket add` с пустым телом и невнятной ошибкой самого сайта.
	if (!line.ref) throw new ProviderError("bad_args", `${line.provider} не дал ref для этой строки — положить в корзину нечем`)
	return line
}

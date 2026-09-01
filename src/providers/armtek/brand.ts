// brand.ts — выбор бренда среди точных совпадений артикула.
//
// У armtek один артикул выпускают до четырёх брендов, а `PIN` приходит в
// форматировании производителя («W 610/6» против «W6106»), поэтому сравнение
// идёт только по нормализованным ключам SDK.

import { ProviderError, brandKey } from "../../sdk/index.ts"
import * as api from "./api.ts"
import type { RawArticle } from "./api.ts"
import { exactRows, toBrandHits } from "./map.ts"

export type Place = { vkorg: string; vstel: string }

export type Resolved = {
	/** Строка выбранного бренда. */
	row: RawArticle
	/** Все точные совпадения — пригодятся для подсказки при неоднозначности. */
	rows: RawArticle[]
}

/** Точные совпадения артикула: queryType 2 отсекает аналоги на стороне сайта. */
export async function exactSearch(article: string, token: string, place: Place, page = 1): Promise<RawArticle[]> {
	const r = await api.search({ query: article, queryType: 2, page, typeView: "list", ...place }, token)
	return exactRows(r.articlesData ?? [], article)
}

/**
 * Бренд по имени. Нет ни одной строки — `notfound`; строки есть, а бренд не
 * подошёл — `ambiguous` со списком: это ровно тот случай, когда агрегатору
 * надо переспросить, а не гадать.
 */
export async function resolve(article: string, brand: string, token: string, place: Place): Promise<Resolved> {
	const rows = await exactSearch(article, token, place)
	if (!rows.length) throw new ProviderError("notfound", `armtek: артикул ${article} не найден`)
	const want = brandKey(brand)
	const row = rows.find(a => brandKey(a.BRAND) === want)
	if (!row) throw new ProviderError("ambiguous", `armtek: бренд «${brand}» не выпускает ${article}; выбери из списка`, toBrandHits(rows))
	return { row, rows }
}

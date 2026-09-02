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

/**
 * Сколько страниц точной выдачи забираем. Страница — 36 строк, а один артикул
 * выпускают до полусотни брендов: обрезать список на первой странице значит
 * соврать в ответе на вопрос «кто это выпускает». Потолок нужен на случай,
 * если сайт когда-нибудь сочтёт точным совпадением полтысячи строк.
 */
export const MAX_PAGES = 5

/** Точные совпадения артикула: queryType 2 отсекает аналоги на стороне сайта. */
export async function exactSearch(article: string, token: string, place: Place): Promise<RawArticle[]> {
	const first = await api.search({ query: article, queryType: 2, page: 1, typeView: "list", ...place }, token)
	const rows = [...(first.articlesData ?? [])]
	const pages = Math.min(first.pagination?.pageCount ?? 1, MAX_PAGES)
	if (pages > 1) {
		const rest = await Promise.all(
			Array.from({ length: pages - 1 }, (_, i) =>
				api.search({ query: article, queryType: 2, page: i + 2, typeView: "list", ...place }, token)))
		for (const r of rest) rows.push(...(r.articlesData ?? []))
	}
	return exactRows(rows, article)
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

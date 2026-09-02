// brand.ts — артикул → производитель. Один артикул бывает у нескольких
// производителей, и цены/отзывы у них разные, поэтому без уточнения — ambiguous.

import { ProviderError, brandKey } from "../../sdk/index.ts"
import * as api from "./api.ts"
import type { SearchHit } from "./api.ts"

export type Brand = { id: number; name: string; goodsName?: string }

export function pickBrand(hits: SearchHit[], given?: string): Brand {
	if (!hits.length) throw new ProviderError("notfound", "артикул не найден")
	const pick = (h: SearchHit): Brand => ({ id: h.manufacturer.id, name: h.manufacturer.name, goodsName: h.goodsName })
	if (given && /^\d+$/.test(given)) {
		const h = hits.find(x => x.manufacturer.id === Number(given))
		return h ? pick(h) : { id: Number(given), name: "" }
	}
	if (given) {
		const h = hits.find(x => brandKey(x.manufacturer.name) === brandKey(given))
		if (h) return pick(h)
	}
	if (hits.length === 1 && !given) return pick(hits[0]!)
	throw new ProviderError("ambiguous",
		given ? `бренда «${given}» у артикула нет — выбери из списка` : "артикул есть у нескольких производителей — уточни бренд",
		hits.map(h => ({ brand: h.manufacturer.name, article: h.article, name: h.goodsName, extra: { manufacturerId: h.manufacturer.id } })))
}

export async function resolveBrand(article: string, given?: string): Promise<Brand> {
	const { items } = await api.searchArticle(article)
	return pickBrand(items ?? [], given)
}

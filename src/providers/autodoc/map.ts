// map.ts — сырые ответы web.autodoc.ru → типы контракта. Формы ответов см. в
// docs/autodoc-api.md и test/fixtures/autodoc/*.json.

import { articleKey, brandKey, render } from "../../sdk/index.ts"
import type { Basket, BasketItem, BrandHit, Car, Offer, Product, Rating, Review, Reviews } from "../../sdk/index.ts"

import type { Car as ApiCar, CatalogGood, GoodsInfo, Reviews as ApiReviews, SearchHit, Suggestion } from "./api.ts"

const { isoDate } = render

export type OriginalsItem = {
	id: number; price: number; quantity?: number; deliveryDays?: number; deliveryDate?: string
	supplier?: { name?: string; description?: string }
	partnerId?: number; priceType?: number; directionToManufacturerId?: number; minimalQuantity?: number; hash?: string
}
export type OriginalsGood = {
	article: string; displayArticle?: string; name: string; manufacturer: { id: number; name: string }
	minimalPrice?: number; minimalDeliveryDays?: number; imageUrl?: string
	rating?: { average: number; quantity: number }; isOriginal?: boolean; items: OriginalsItem[]
}
export type Originals = { items: { id: string; title: string; goods: OriginalsGood[] }[] }

/** Что фронт шлёт в POST basket/items — всё берётся из строки прайса. */
export type AutodocRef = {
	priceId: number; partnerId?: number; directionToManufacturerId?: number
	article: string; partName: string; priceType?: number; price: number; deliveryDays?: number
	minimalQuantity: number; hash?: string; manufacturerId: number
}

export type RawBasketItem = Record<string, unknown> & { id: number | string; quantity: number; price: number; priceType?: number; hash?: string }
export type RawBasket = { total?: number; items?: RawBasketItem[] }

export const toRating = (r?: { average: number; quantity: number } | null): Rating | undefined =>
	r && r.quantity ? { average: r.average, count: r.quantity } : undefined

export function toBrandHits(hits: SearchHit[], infos: Map<number, GoodsInfo | null>): BrandHit[] {
	return hits.map(h => {
		const info = infos.get(h.manufacturer.id)
		return {
			brand: h.manufacturer.name, article: h.article, name: h.goodsName || info?.name,
			rating: toRating(info?.rating),
			images: h.imageUrl ? [h.imageUrl] : info?.imageUrls,
			extra: { manufacturerId: h.manufacturer.id },
		}
	})
}

export function toOffers(r: Originals, article: string, brand: string, forceAnalog = false): Offer[] {
	const wantArticle = articleKey(article)
	const wantBrand = brandKey(brand)
	const out: Offer[] = []
	for (const group of r.items ?? []) {
		for (const g of group.goods ?? []) {
			const analog = forceAnalog || articleKey(g.article) !== wantArticle || brandKey(g.manufacturer.name) !== wantBrand
			for (const it of g.items ?? []) {
				const ref: AutodocRef = {
					priceId: it.id, partnerId: it.partnerId, directionToManufacturerId: it.directionToManufacturerId,
					article: g.article, partName: g.name, priceType: it.priceType, price: it.price, deliveryDays: it.deliveryDays,
					minimalQuantity: it.minimalQuantity ?? 1, hash: it.hash, manufacturerId: g.manufacturer.id,
				}
				out.push({
					article: g.displayArticle ?? g.article, brand: g.manufacturer.name, name: g.name,
					price: it.price, currency: "RUB", quantity: it.quantity,
					deliveryDays: it.deliveryDays, deliveryDate: isoDate(it.deliveryDate),
					seller: [it.supplier?.name, it.supplier?.description].filter(Boolean).join(" · ") || undefined,
					rating: toRating(g.rating), images: g.imageUrl ? [g.imageUrl] : undefined,
					url: `https://www.autodoc.ru/price/${g.manufacturer.id}/${g.article}`,
					ref: ref as unknown as Record<string, unknown>,
					...(analog ? { analog: true, analogOf: { article, brand } } : {}),
					extra: { group: group.title, minimalQuantity: it.minimalQuantity, priceType: it.priceType },
				})
			}
		}
	}
	return out
}

/** Категории из подсказки: routeUrl вида /catalogs/universal/goods/bolty-408. Производители (/man/…) не нужны. */
export function categoryIds(s: Suggestion[]): { id: number; title: string }[] {
	const out: { id: number; title: string }[] = []
	for (const it of s) {
		const m = it.routeUrl?.match(/\/goods\/[^/]*-(\d+)$/)
		if (m) out.push({ id: Number(m[1]), title: it.title })
	}
	return out
}

export const toProducts = (goods: CatalogGood[], category?: string): Product[] =>
	goods.map(g => ({
		article: g.article, brand: g.manufacturer?.name ?? "", name: g.name,
		price: g.price, currency: "RUB", quantity: g.quantity, rating: toRating(g.rating), category,
		url: g.manufacturer ? `https://www.autodoc.ru/price/${g.manufacturer.id}/${g.article}` : undefined,
	}))

export function toReviews(r: ApiReviews, info: GoodsInfo | null): Reviews {
	const items: Review[] = (r.items ?? []).map(it => ({
		author: it.clientName, date: isoDate(it.createdDate), rating: it.mark,
		pros: it.pros || undefined, cons: it.cons || undefined, text: it.content ?? "",
		purchased: /куплен/i.test(it.clientLabel ?? ""),
	}))
	const rating = toRating(info?.rating)
	return {
		total: r.totalCount ?? items.length,
		rating: rating ? { ...rating, histogram: info?.rating?.ratings } : undefined,
		summary: r.summary ? { pros: r.summary.pros ?? [], cons: r.summary.cons ?? [] } : undefined,
		items,
	}
}

export const toCars = (cars: ApiCar[], mainId?: number | null): Car[] =>
	cars.map(c => ({
		brand: c.brand, model: c.model, year: c.year, engine: c.engine, vin: c.vin, odometer: c.odometer || undefined,
		ref: { carId: c.id, modificationId: c.modificationId, main: c.id === mainId },
	}))

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)
const numv = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)

export function toBasket(raw: RawBasket): Basket {
	const items: BasketItem[] = (raw.items ?? []).map(it => {
		const man = it.manufacturer as { name?: string } | undefined
		return {
			id: String(it.id), article: str(it.displayArticle) ?? str(it.article) ?? "", brand: man?.name ?? str(it.manufacturerName) ?? "",
			name: str(it.name), price: it.price, quantity: it.quantity, sum: numv(it.total) ?? it.price * it.quantity,
			seller: str(it.supplierName), deliveryDays: numv(it.deliveryDays), deliveryDate: isoDate(str(it.deliveryDate)),
			extra: { priceType: it.priceType, hash: it.hash, description: it.description },
		}
	})
	return { items, total: raw.total, currency: "RUB", url: "https://www.autodoc.ru/basket" }
}

export const basketAddBody = (ref: AutodocRef, qty: number): Record<string, unknown> => ({
	priceId: ref.priceId, partnerId: ref.partnerId, directionToManufacturerId: ref.directionToManufacturerId,
	article: ref.article, partName: ref.partName, quantity: qty, price: ref.price, priceType: ref.priceType,
	description: "", deliveryDays: ref.deliveryDays,
})

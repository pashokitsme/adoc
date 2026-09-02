// map.ts — сырые ответы web.autodoc.ru → типы контракта. Формы ответов см. в
// docs/autodoc-api.md и test/fixtures/autodoc/http/*.json.

import { articleKey, brandKey, render } from "../../sdk/index.ts"
import type { Basket, BasketItem, BrandHit, Car, Info, Offer, Order, OrderItem, Product, Rating, Review, Reviews } from "../../sdk/index.ts"

import type { Car as ApiCar, CatalogGood, GoodsInfo, GoodsPrice, OrderRow, Reviews as ApiReviews, SearchHit, Suggestion } from "./api.ts"

const { isoDate } = render

export const SITE = "https://www.autodoc.ru"

/**
 * Адреса страниц сайта. Сняты не с догадок, а из таблицы маршрутов Angular
 * (`chunk-*.js`) и из шаблонов, которые эти ссылки строят, — подробности в
 * notes/providers-v2.md. Артикул в адресе карточки сайт приводит к нижнему
 * регистру (так же он проставляет canonical), поэтому и мы приводим.
 */
export const cardUrl = (manufacturerId: number, article: string): string =>
	`${SITE}/man/${manufacturerId}/part/${article.toLowerCase()}`

export const reviewsUrl = (manufacturerId: number, article: string): string =>
	`${cardUrl(manufacturerId, article)}/reviews`

/** Прайс-лист: страница с предложениями продавцов по этой детали. */
export const priceUrl = (manufacturerId: number, article: string): string =>
	`${SITE}/price/${manufacturerId}/${article.toLowerCase()}`

export const BASKET_URL = `${SITE}/cart`
export const ORDERS_URL = `${SITE}/my/orders`

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
			url: cardUrl(h.manufacturer.id, h.article),
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
					url: priceUrl(g.manufacturer.id, g.article),
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

/**
 * Какая из найденных категорий отвечает на запрос. Подсказка отдаёт их в своём
 * порядке, и на «тормозные колодки» первыми идут «Станки для заклепки
 * тормозных колодок» — формально совпадение, по делу мусор.
 *
 * Считаем долю слов заголовка, нашедшихся в запросе: у «Колодки тормозные» это
 * 2 из 2, у станков — 2 из 5. Слова сравниваются по общему префиксу, иначе
 * «свеча» и «свечи» разошлись бы; четырёх букв хватает и для «колодки» против
 * «колодок». Ничья — за первым, то есть порядок сайта остаётся значимым.
 */
const words = (s: string): string[] =>
	s.toLowerCase().replace(/ё/g, "е").split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1)

const sameWord = (a: string, b: string): boolean => {
	const n = Math.min(a.length, b.length)
	let i = 0
	while (i < n && a[i] === b[i]) i++
	return i >= Math.min(4, n)
}

export function bestCategory<T extends { title: string }>(cats: T[], query: string): T {
	const q = words(query)
	let best = cats[0]!
	let bestScore = -1
	for (const c of cats) {
		const t = words(c.title)
		if (!t.length) continue
		const hit = t.filter(w => q.some(x => sameWord(w, x))).length
		const score = hit / t.length
		if (score > bestScore) { bestScore = score; best = c }
	}
	return best
}

/**
 * Ref машины → параметры find-goods. Фильтр включается только при всех трёх
 * значениях, поэтому неполный ref — это `null`, а не половинчатый фильтр,
 * который молча вернул бы выдачу «по всей марке».
 */
export function carQuery(ref: Record<string, unknown> | null):
	{ BrandName: string; Model: number; ModificationId: number } | undefined {
	if (!ref) return undefined
	const brand = ref.brandName
	const model = ref.modelId
	const mod = ref.modificationId
	if (typeof brand !== "string" || !brand || typeof model !== "number" || typeof mod !== "number") return undefined
	return { BrandName: brand, Model: model, ModificationId: mod }
}

export const toProducts = (goods: CatalogGood[], category?: string): Product[] =>
	goods.map(g => ({
		article: g.article, brand: g.manufacturer?.name ?? "", name: g.name,
		price: g.price, currency: "RUB", quantity: g.quantity, rating: toRating(g.rating), category,
		images: g.imageUrl ? [g.imageUrl] : undefined,
		// карточка, а не прайс-лист: с неё видно и цену, и отзывы, и применимость
		url: g.manufacturer ? cardUrl(g.manufacturer.id, g.article) : undefined,
		extra: g.manufacturer ? { manufacturerId: g.manufacturer.id } : undefined,
	}))

export function toReviews(r: ApiReviews, info: GoodsInfo | null, url?: string): Reviews {
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
		url,
	}
}

/**
 * Карточка. Характеристики сайт показывает списком «имя — значение, единица»;
 * складывать их в описание одной строкой — единственный способ показать их в
 * контрактном `Info`, где для таблицы характеристик места нет.
 */
export function toInfo(g: GoodsInfo, price: GoodsPrice | null): Info {
	const props = (g.items ?? []).map(i => `${i.name}: ${i.value}${i.unit ? ` ${i.unit}` : ""}`)
	const rating = toRating(g.rating)
	return {
		article: g.article,
		brand: g.manufacturer.name,
		name: g.fullName || g.name,
		url: cardUrl(g.manufacturer.id, g.article),
		rating: rating ? { ...rating, histogram: g.rating?.ratings } : undefined,
		images: g.imageUrls,
		price: price?.minimalPrice,
		currency: price?.minimalPrice === undefined ? undefined : "RUB",
		deliveryDays: price?.minimalDeliveryDays,
		// склад у autodoc один и без названия — только общий остаток
		stock: g.inStock ? [{ code: "autodoc", name: "на складе", quantity: g.inStock }] : undefined,
		description: props.length ? props.join("; ") : undefined,
		extra: {
			manufacturerId: g.manufacturer.id,
			...(g.categoryId ? { categoryId: g.categoryId } : {}),
			...(g.items?.length ? { properties: g.items } : {}),
			offersUrl: priceUrl(g.manufacturer.id, g.article),
			reviewsUrl: reviewsUrl(g.manufacturer.id, g.article),
		},
	}
}

/**
 * Заказы. Ручка отдаёт не заказы, а позиции: у каждой свой статус, своя сумма
 * и ровно один товар; общего номера заказа в ответе нет. Поэтому один `Order`
 * — это одна позиция, ровно так, как её показывает и отменяет сам сайт.
 */
export function toOrders(rows: OrderRow[]): Order[] {
	return rows.map(r => {
		const item: OrderItem | undefined = r.goods && {
			article: r.goods.article,
			brand: r.goods.manufacturerName,
			name: r.goods.goodsName ?? "",
			qty: r.quantity ?? 1,
			price: r.price ?? 0,
			sum: r.total,
			url: cardUrl(r.goods.manufacturerId, r.goods.article),
		}
		return {
			id: String(r.id),
			// у части позиций сайт отдаёт «0001-01-01T00:00:00» — это не дата,
			// а пустое значение SAP; лучше отдать пустую строку, чем первый век
			date: r.createDate && !r.createDate.startsWith("0001") ? r.createDate : "",
			status: r.status?.name ?? "",
			total: r.total ?? 0,
			currency: "RUB",
			url: ORDERS_URL,
			items: item ? [item] : undefined,
			extra: {
				...(r.status?.text ? { statusText: r.status.text } : {}),
				...(r.deliveryStatusName ? { deliveryStatus: r.deliveryStatusName } : {}),
				...(r.waitInShopDate ? { waitInShopDate: r.waitInShopDate } : {}),
				...(r.description ? { description: r.description } : {}),
				...(r.isCancelable ? { cancelable: true } : {}),
			},
		}
	})
}

export const toCars = (cars: ApiCar[], mainId?: number | null): Car[] =>
	cars.map(c => ({
		brand: c.brand, model: c.model, year: c.year, engine: c.engine, vin: c.vin, odometer: c.odometer || undefined,
		// brandName и modelId нужны поиску с учётом машины: find-goods фильтрует
		// только когда пришли все три — марка, id модели и id модификации
		ref: {
			carId: c.id, modificationId: c.modificationId, modelId: c.modelId,
			brandName: c.brand, main: c.id === mainId,
		},
	}))

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)
const numv = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)

export function toBasket(raw: RawBasket): Basket {
	const items: BasketItem[] = (raw.items ?? []).map(it => {
		// Артикул, производитель и поставщик лежат во вложенном priceItem —
		// плоских полей у позиции корзины нет; читаем и то, и другое, чтобы
		// команда не разъезжалась с записанными ответами прошлых версий.
		const pi = it.priceItem as {
			article?: string; displayArticle?: string
			manufacturer?: { id?: number; name?: string }
			supplier?: { name?: string; description?: string }
		} | undefined
		const man = (pi?.manufacturer ?? it.manufacturer) as { id?: number; name?: string } | undefined
		const manId = man?.id ?? numv(it.manufacturerId)
		const article = str(pi?.article) ?? str(it.article) ?? str(pi?.displayArticle) ?? str(it.displayArticle)
		const seller = [pi?.supplier?.name, pi?.supplier?.description].filter(Boolean).join(" · ")
		return {
			id: String(it.id),
			article: str(it.displayArticle) ?? str(pi?.displayArticle) ?? article ?? "",
			brand: man?.name ?? str(it.manufacturerName) ?? "",
			name: str(it.name), price: it.price, quantity: it.quantity, sum: numv(it.total) ?? it.price * it.quantity,
			seller: seller || str(it.supplierName),
			deliveryDays: numv(it.deliveryDays), deliveryDate: isoDate(str(it.deliveryDate)),
			url: manId !== undefined && article ? cardUrl(manId, article) : undefined,
			extra: { priceType: it.priceType, hash: it.hash, description: it.description },
		}
	})
	return { items, total: raw.total, currency: "RUB", url: BASKET_URL }
}

export const basketAddBody = (ref: AutodocRef, qty: number): Record<string, unknown> => ({
	priceId: ref.priceId, partnerId: ref.partnerId, directionToManufacturerId: ref.directionToManufacturerId,
	article: ref.article, partName: ref.partName, quantity: qty, price: ref.price, priceType: ref.priceType,
	description: "", deliveryDays: ref.deliveryDays,
})

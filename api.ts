// api.ts — эндпоинты web.autodoc.ru. Полная карта — в autodoc-api.md.
//
// Всё, что не требует токена, работает и без входа; предложения продавцов,
// корзина, избранное, заказы и профиль отдают 401 с пустым телом, поэтому
// ошибку приходится опознавать по статусу, а не по JSON.

import { currentToken } from "./auth.ts"

export const BASE = "https://web.autodoc.ru"

export class ApiError extends Error {
	constructor(readonly status: number, readonly path: string, readonly body: string) {
		super(status === 401
			? `${path}: нужен вход — запусти \`adoc login\``
			: `${path}: HTTP ${status}${body ? ` — ${body.slice(0, 200)}` : ""}`)
	}
}

type Query = Record<string, string | number | boolean | undefined>

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, opts: {
	query?: Query
	body?: unknown
	auth?: boolean
} = {}): Promise<T> {
	const url = new URL(BASE + path)
	for (const [k, v] of Object.entries(opts.query ?? {})) {
		if (v !== undefined && v !== "") url.searchParams.set(k, String(v))
	}

	const headers: Record<string, string> = { accept: "application/json" }
	if (opts.body !== undefined) headers["content-type"] = "application/json"
	if (opts.auth) {
		const token = await currentToken()
		if (!token) throw new ApiError(401, path, "")
		headers.authorization = `Bearer ${token}`
	}

	const res = await fetch(url, {
		method,
		headers,
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
	})
	const text = await res.text()
	if (!res.ok) throw new ApiError(res.status, path, text)
	return (text ? JSON.parse(text) : null) as T
}

// --- типы ответов (только используемые поля) ------------------------------

export type Manufacturer = { id: number; name: string; logoUrl?: string; imageUrl?: string }
export type Rating = { average: number; quantity: number; ratings?: number[] }

export type SearchHit = { article: string; goodsName: string; manufacturer: Manufacturer; imageUrl?: string }
export type GoodsInfo = {
	article: string; name: string; fullName?: string; categoryId?: number
	manufacturer: Manufacturer; rating: Rating; inStock?: number
	isFavorite?: boolean; imageUrls?: string[]
}
export type GoodsPrice = { minimalPrice: number; minimalDeliveryDays: number }
export type Review = {
	content: string; clientName?: string; clientLabel?: string; mark?: number
	createdDate?: string; pros?: string; cons?: string
	status?: { status: string; name: string }
	likes?: { count: number }; images?: { url?: string }[]
}
export type Reviews = {
	totalCount: number
	summary?: { name?: string; pros?: string[]; cons?: string[] }
	sorting?: { id: number; name: string }[]
	items: Review[]
}
export type Suggestion = { title: string; subtitle?: string; routeUrl?: string }
export type CatalogGood = {
	article: string; name: string; manufacturer: Manufacturer
	price?: number; quantity?: number; rating?: Rating; isFavorite?: boolean
}
export type Offer = {
	price?: number; deliveryDays?: number; quantity?: number
	partnerName?: string; distributorName?: string; name?: string
	manufacturer?: Manufacturer; article?: string
}

// --- публичное ------------------------------------------------------------

/** Производители, у которых есть такой артикул. Параметр строчный — так в API. */
export const searchArticle = (article: string) =>
	call<{ items: SearchHit[] }>("GET", "/api/price-service/search/manufacturers", { query: { article } })

export const goodsInfo = (Article: string, ManufacturerId: number) =>
	call<GoodsInfo>("GET", "/api/goods-service/goods/info", { query: { Article, ManufacturerId } })

export const goodsPrice = (Article: string, ManufacturerId: number) =>
	call<GoodsPrice>("GET", "/api/goods-service/goods/price", { query: { Article, ManufacturerId } })

export const reviews = (Article: string, ManufacturerId: number, opts: {
	PageNumber?: number; MaxResultCount?: number; SortOrder?: number; AllReviews?: boolean
} = {}) =>
	call<Reviews>("GET", "/api/goods-service/feedback/messages", {
		query: { Article, ManufacturerId, PageNumber: 1, MaxResultCount: 10, ...opts },
	})

/** Подсказка по названию: производители и категории, не товары. */
export const suggest = (SearchText: string) =>
	call<{ items: Suggestion[] }>("POST", "/api/catalog-universal-service/catalog-universal-categories/search", {
		query: { SearchText }, body: {},
	})

/** Товары внутри категории. Без CategoryId эндпоинт всегда отдаёт 0. */
export const categoryGoods = (CategoryId: number, opts: { PageNumber?: number; SortingId?: number } = {}) =>
	call<{ totalCount: number; items: CatalogGood[]; sorting?: { id: number; name: string }[] }>(
		"POST", "/api/catalog-universal-service/catalog-universal-goods/find-goods",
		{ query: { CategoryId, PageNumber: 1, ...opts }, body: {} },
	)

// --- требует токена -------------------------------------------------------

export const offers = (Article: string, ManufacturerId: number) =>
	call<unknown>("GET", "/api/price-service/price-list/originals", {
		query: { Article, ManufacturerId, LoadAnalogs: false }, auth: true,
	})

export const analogs = (Article: string, ManufacturerId: number) =>
	call<unknown>("GET", "/api/price-service/price-list/analogs", {
		query: { Article, ManufacturerId }, auth: true,
	})

export const basket = () => call<unknown>("GET", "/api/basket-service/basket/items", { auth: true })
export const basketCount = () => call<unknown>("GET", "/api/basket-service/basket/count", { auth: true })
export const favorites = (Id?: number) =>
	call<unknown>("GET", "/api/favorite-service/favorites/favorites", { query: { Id }, auth: true })
export const favoriteLists = () => call<unknown>("GET", "/api/favorite-service/favorites/lists", { auth: true })
export const addFavorite = (Article: string, ManufacturerId: number, ListId?: number) =>
	call<unknown>("POST", "/api/favorite-service/favorites/favorite", {
		query: { Article, ManufacturerId, ListId }, body: {}, auth: true,
	})
export const orders = (q: { BeginDate?: string; EndDate?: string; Statuses?: string } = {}) =>
	call<unknown>("GET", "/api/order-service/orders/items", { query: q, auth: true })
export const profile = () => call<unknown>("GET", "/api/client-service/profile/account-summary", { auth: true })

/** Произвольный путь — чтобы дотянуться до всего, что есть в autodoc-api.md. */
export const raw = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, query: Query, auth: boolean) =>
	call<unknown>(method, path, { query, body: method === "GET" ? undefined : {}, auth })

// api.ts — эндпоинты web.autodoc.ru. Полная карта — в autodoc-api.md.
//
// Всё, что не требует токена, работает и без входа; предложения продавцов,
// корзина, избранное, заказы и профиль отдают 401 с пустым телом, поэтому
// ошибку приходится опознавать по статусу, а не по JSON.

import { currentToken } from "./auth.ts"
// только типы: цикл api ↔ map существует лишь на уровне типов и стирается при сборке
import type { Originals, RawBasket } from "./map.ts"

/**
 * База API. Переопределяется только тестами (`ADOC_AUTODOC_BASE`), чтобы
 * поднять локальный сервер и проверить поведение на зависшем ответе.
 * Принимается только localhost: по этому адресу уходит Bearer-токен, и
 * переменная окружения не должна уметь увести его на чужой хост.
 */
function localBase(v: string | undefined): string | undefined {
	if (!v) return undefined
	try {
		const host = new URL(v).hostname
		return host === "localhost" || host === "127.0.0.1" || host === "[::1]" ? v : undefined
	} catch {
		return undefined
	}
}
export const BASE = localBase(process.env.ADOC_AUTODOC_BASE) ?? "https://web.autodoc.ru"

/**
 * Потолок ожидания сети. Без него зависший ответ держал бы процесс до
 * умолчаний ОС, а агрегатор не отличил бы «сайт молчит» от «команда думает».
 * `ADOC_TIMEOUT_MS` — только для тестов.
 */
export const TIMEOUT_MS = Number(process.env.ADOC_TIMEOUT_MS) || 20_000

/** Обрыв по таймеру: fetch отдаёт его как TimeoutError, отмену — как AbortError. */
export const isTimeout = (e: unknown): boolean =>
	e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")

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
	// Фикстурный режим: ответы читаются с диска, сеть не трогаем совсем.
	// Имя файла — метод и путь: `<METHOD>_<путь с _ вместо />.json`.
	const fixtures = process.env.ADOC_FIXTURES
	if (fixtures) {
		if (opts.auth && !(await currentToken())) throw new ApiError(401, path, "")
		const name = `${method}_${path.replace(/\//g, "_")}.json`
		const f = Bun.file(`${fixtures}/${name}`)
		if (!(await f.exists())) throw new ApiError(404, path, `нет фикстуры ${name}`)
		return JSON.parse(await f.text()) as T
	}

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
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	const text = await res.text()
	if (!res.ok) throw new ApiError(res.status, path, text)
	if (!text) return null as T
	try {
		return JSON.parse(text) as T
	} catch {
		// 200 с HTML — обычно прокси или страница-заглушка, а не ответ API
		throw new ApiError(res.status, path, `сервер вернул не JSON: ${text.slice(0, 120)}`)
	}
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
	call<Originals>("GET", "/api/price-service/price-list/originals", {
		query: { Article, ManufacturerId, LoadAnalogs: false }, auth: true,
	})

export const analogs = (Article: string, ManufacturerId: number) =>
	call<Originals>("GET", "/api/price-service/price-list/analogs", {
		query: { Article, ManufacturerId }, auth: true,
	})

export const basket = () => call<RawBasket>("GET", "/api/basket-service/basket/items", { auth: true })
export const basketAdd = (body: Record<string, unknown>) =>
	call<unknown>("POST", "/api/basket-service/basket/items", { body, auth: true })
export const basketUpdate = (body: { id: number | string; quantity: number; description?: string; priceType?: number; hash?: string }) =>
	call<unknown>("PUT", "/api/basket-service/basket/items", { body, auth: true })
export const basketDelete = (body: { items: { id: number | string; priceType?: number; hash?: string }[]; deleteAll: false }) =>
	call<unknown>("DELETE", "/api/basket-service/basket/items", { body, auth: true })
export const basketCount = () => call<unknown>("GET", "/api/basket-service/basket/count", { auth: true })
export const favorites = (Id?: number) =>
	call<unknown>("GET", "/api/favorite-service/favorites/favorites", { query: { Id }, auth: true })
export const favoriteLists = () => call<unknown>("GET", "/api/favorite-service/favorites/lists", { auth: true })
export const addFavorite = (Article: string, ManufacturerId: number, ListId?: number) =>
	call<unknown>("POST", "/api/favorite-service/favorites/favorite", {
		query: { Article, ManufacturerId, ListId }, body: {}, auth: true,
	})
// --- гараж ----------------------------------------------------------------

export type Car = {
	id: number
	brand: string
	brandId: number
	model: string
	modelId: number
	modificationId: number
	engine?: string
	year?: number
	vin?: string
	odometer?: number
	fullName?: string
	clientCode?: string
	activeRequestsCount?: number
}

export type CarGood = {
	groupName?: string
	article: string
	name: string
	manufacturer?: Manufacturer
	items?: { price?: number; quantity?: number; deliveryDays?: number }[]
}

export const garageCars = () =>
	call<{ cars: Car[]; totalActiveRequestsCount?: number }>("GET", "/api/garage-service/garage/cars", { auth: true })

/** Основная машина гаража — та, под которую сайт подбирает запчасти. */
export const garageTopCar = () =>
	call<{ car: Car | null }>("GET", "/api/garage-service/garage/top-car", { auth: true })

export const garageProducts = (carId: number) =>
	call<{ modification?: string; goods?: CarGood[] }>(
		"GET", `/api/garage-service/garage/${carId}/products-lite`, { auth: true })

export const garageSetMain = (carId: number) =>
	call<unknown>("PUT", `/api/garage-service/garage/main-car/${carId}`, { body: {}, auth: true })

export const orders = (q: { BeginDate?: string; EndDate?: string; Statuses?: string } = {}) =>
	call<unknown>("GET", "/api/order-service/orders/items", { query: q, auth: true })
export const profile = () => call<unknown>("GET", "/api/client-service/profile/account-summary", { auth: true })

/** Произвольный путь — чтобы дотянуться до всего, что есть в autodoc-api.md. */
export const raw = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, query: Query, auth: boolean) =>
	call<unknown>(method, path, { query, body: method === "GET" ? undefined : {}, auth })

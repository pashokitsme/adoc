// api.ts — HTTP-слой armtek.ru: конверт ответа, заголовки, ошибки, эндпоинты.
//
// Свой REST лежит на https://armtek.ru/rest/ru/ и документации не имеет;
// карта и проверенные вызовы — docs/armtek-api.md. Любой ответ приходит
// конвертом {data, arr_messages, execution_time}: текст ошибки для человека
// лежит в arr_messages[] с type === "E", а код — в HTTP-статусе.

import { HttpError, ProviderError, browserHeaders, fetchJson } from "../../sdk/index.ts"

export const BASE = "https://armtek.ru/rest/ru/"
/** Страница, с которой запрос как бы уходит: тот же хост, что и у REST. */
export const SITE = "https://armtek.ru"

/** Сбытовая организация: 4000 — Россия, 2000 — Беларусь, 8000 — Казахстан. */
export const DEFAULT_VKORG = "4000"
/** «Москва МКАД 86 км» — точка выдачи по умолчанию из бандла фронта. */
export const DEFAULT_VSTEL = "ME86"

/**
 * Статические заголовки фронта. `X-AUTH-*` — константы из бандла, без них
 * auth-microservice отвечает 401 даже на выдачу гостевого токена.
 *
 * `X-CA-VKORG` идёт во все вызовы, а не только в те, где он обязателен:
 * `GET cart-microservice/v1/base` без него отдаёт 200 и пустую корзину вместо
 * ошибки, то есть забытый заголовок выглядит как «корзина пуста». Дешевле
 * слать всегда, чем ловить это по месту.
 */
export const FRONT_HEADERS: Readonly<Record<string, string>> = {
	"X-AUTH-SYSTEM": "AUTH_MICROSERVICE_V1_ARMTEK_RU",
	"X-AUTH-TOKEN": "nJhNK87gJOOU6dfr",
}

export type ArmMessage = { type: string; text: string }
export type Envelope<T> = { data: T; arr_messages?: ArmMessage[] }

export type CallOpts = {
	method?: string
	body?: unknown
	token?: string
	/** Значение X-CA-VKORG; по умолчанию DEFAULT_VKORG. */
	vkorg?: string
	/** Дополнительные заголовки; перебивают вычисленные. */
	headers?: Record<string, string>
	timeoutMs?: number
}

// --- транспорт ------------------------------------------------------------

export type Transport = (url: string, init: RequestInit, opts: { timeoutMs?: number }) => Promise<unknown>

const network: Transport = (url, init, opts) => fetchJson(url, init, opts)
let transport: Transport = network

/**
 * Шов для тестов: подменяет сетевой вызов целиком, чтобы `bun test` не ходил
 * в сеть и мог проверить заголовки и порядок запросов. `null` возвращает сеть.
 */
export function setTransport(t: Transport | null): void {
	transport = t ?? network
}

/** Заголовки исходящего запроса — отдельно от call(), чтобы их можно было проверить. */
export function requestHeaders(opts: CallOpts = {}): Record<string, string> {
	return {
		...browserHeaders(SITE),
		...FRONT_HEADERS,
		Accept: "application/json",
		"X-CA-VKORG": opts.vkorg ?? DEFAULT_VKORG,
		...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
		...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
		...opts.headers,
	}
}

// --- ошибки ---------------------------------------------------------------

/** Тексты ошибок из конверта; всё остальное (I, S, W) — не ошибки. */
export function errorTexts(env: unknown): string[] {
	const msgs = (env as Envelope<unknown> | null)?.arr_messages
	if (!Array.isArray(msgs)) return []
	return msgs.filter(m => m?.type === "E" && typeof m.text === "string").map(m => m.text)
}

/**
 * 429 с captchaHash — отдельный класс, а не просто текст: сайт ограничивает
 * ровно того, кто спрашивает, и вызывающий, у которого есть второй токен,
 * должен уметь опознать этот случай, не сверяя сообщение построчно.
 */
export class ThrottledError extends ProviderError {
	constructor() {
		super("http", "armtek: слишком много запросов подряд — сайт просит подождать и показать капчу; повторить через несколько минут")
	}
}

/** Тот самый случай: сайт просит капчу, а не отвечает данными. */
export const isThrottled = (e: unknown): e is ThrottledError => e instanceof ThrottledError

/**
 * HttpError → ошибка контракта. 401 отдельно: агрегатору нужен код `auth`,
 * чтобы сказать «нужен вход», а не «сайт ответил 401».
 */
export function mapHttpError(e: unknown): ProviderError | null {
	if (!(e instanceof HttpError)) return null
	let text = ""
	try { text = errorTexts(JSON.parse(e.body)).join("; ") } catch { /* тело не конверт */ }
	if (e.status === 401) return new ProviderError("auth", text || "armtek: нужен вход")
	if (e.status === 404) return new ProviderError("notfound", text || `armtek: ${e.url} — не найдено`)
	// 429 приходит телом с captchaHash: сайт не сломался, а просит подождать.
	// Без этой ветки человек видел бы простыню с хэшем вместо совета.
	if (e.status === 429) return new ThrottledError()
	return new ProviderError("http", text ? `armtek: ${text}` : e.message)
}

// --- вызов ----------------------------------------------------------------

/** Вызов REST: возвращает `data` из конверта или бросает ProviderError. */
export async function call<T>(path: string, opts: CallOpts = {}): Promise<T> {
	const init: RequestInit = {
		method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
		headers: requestHeaders(opts),
		...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
	}

	let env: Envelope<T> | null
	try {
		env = await transport(BASE + path, init, { timeoutMs: opts.timeoutMs }) as Envelope<T> | null
	} catch (e) {
		throw mapHttpError(e) ?? e
	}

	// Валидация полей приходит статусом 200 или 400 с пустой data — без этой
	// проверки вызывающий получил бы null и счёл бы это пустой выдачей.
	const bad = errorTexts(env)
	if (bad.length && (env == null || env.data == null)) throw new ProviderError("http", `armtek: ${bad.join("; ")}`)
	if (env == null) throw new ProviderError("http", `armtek: пустой ответ на ${path}`)
	return env.data
}

/** Произвольный вызов для команды `raw`: конверт целиком, без разбора. */
export const raw = (method: string, path: string, opts: CallOpts = {}): Promise<unknown> =>
	call<unknown>(path, { ...opts, method })

// --- авторизация ----------------------------------------------------------

export type Tokens = { accessToken: string; refreshToken?: string }

/** Гостевой токен: с ним работают поиск, отзывы и список точек выдачи. */
export const fetchGuestToken = (): Promise<Tokens> =>
	call<Tokens>("auth-microservice/v1/guest", { body: {} })

export const postLogin = (login: string, password: string): Promise<Tokens> =>
	call<Tokens>("auth-microservice/v1/auth/login", { body: { login, password } })

/** Обновление пары токенов; авторизуется refresh-токеном, а не access. */
export const postRefresh = (refreshToken: string): Promise<Tokens> =>
	call<Tokens>("auth-microservice/v1/auth/refresh", { method: "POST", body: {}, token: refreshToken })

export type ClientData = {
	CLIENT_ID?: string
	FIRST_NAME?: string
	MIDDLE_NAME?: string
	LAST_NAME?: string
	EMAILS?: { EMAIL?: string; MAIN?: boolean }[]
	PHONES?: { PHONE_NUMBER_FULL?: string; MAIN?: boolean }[]
	VSTEL?: string
	VSTEL_DATA?: { vstel?: string; vkorg?: string }
	ADDITIONAL?: { CLIENT_CATEGORY?: string; CLIENT_SEGMENT?: string }
}

export const fetchClient = (token: string, vkorg?: string): Promise<ClientData> =>
	call<ClientData>("client-microservice/v1/client/individual/get-client", { token, vkorg })

// --- поиск ----------------------------------------------------------------

export type Pagination = { currentPage: number; perPage: number; totalCount: number; pageCount: number }

/** Предложение: склад, цена, срок. Числа приходят строками. */
export type RawSuggestion = {
	ARTID: number
	PARNR: string
	PRICES1: string
	PRICEP?: string
	PRICER1?: string
	NUMZAK: string
	RVALUE: string
	DLVDT: string
	ORDDT?: string
	KEYZAK: string
	WAERS: string
	CHARG: string
	POSNR?: number
	KWMENG?: number
	MINBM?: number
	TYPE?: string
	NAME?: string
}

/** Строка выдачи typeView "list": пара (артикул, бренд) плюс её предложения. */
export type RawArticle = {
	ARTID: number
	PIN: string
	BRAND: string
	BRAND_ID?: number
	BRAND_ALIAS?: string
	BRAND_ICON?: string
	NAME?: string
	ARTICLE_ALIAS?: string
	PHOTO?: string[]
	RATING?: string
	REVIEW_COUNT?: number
	SUGGESTIONS?: RawSuggestion[]
}

/** Строка выдачи typeView "card": предложение слито с артикулом. */
export type RawCard = RawArticle & Partial<RawSuggestion> & { CUSTOM_NAME?: string }

export type SearchData<T = RawArticle> = {
	typeView: string
	cacheKey?: string
	articlesData: T[]
	pagination: Pagination
}

export type SearchQuery = {
	query: string
	/** 1 — точные совпадения плюс аналоги; 2 — только точные. Проверено 2026-09-02. */
	queryType?: 1 | 2
	page?: number
	typeView?: "list" | "card"
	vkorg?: string
	vstel?: string
}

/**
 * Поиск. `typeView` задаём всегда: сервер иначе выбирает форму ответа сам,
 * по тексту запроса, и «card» приходит без SUGGESTIONS.
 */
export function search(q: SearchQuery & { typeView?: "list" }, token: string): Promise<SearchData<RawArticle>>
export function search(q: SearchQuery & { typeView: "card" }, token: string): Promise<SearchData<RawCard>>
export function search(q: SearchQuery, token: string): Promise<SearchData<RawArticle | RawCard>> {
	const vkorg = q.vkorg ?? DEFAULT_VKORG
	return call("search-microservice/v1/search", {
		token,
		vkorg,
		body: {
			query: q.query,
			queryType: q.queryType ?? 1,
			page: q.page ?? 1,
			typeView: q.typeView ?? "list",
			userInfo: { VKORG: vkorg, VSTELS_LIST: [q.vstel ?? DEFAULT_VSTEL] },
			ZZSIGN: "S",
		},
	})
}

export type SuggestCategory = { ID: string; ALIAS: string; NAME: string; PATH?: { ID: string; NAME: string; ALIAS: string }[] }
export type Autocomplete = {
	suggest?: { NAME?: string }[]
	category?: SuggestCategory[]
	brands?: { BRAND?: string; BRAND_ALIAS?: string }[]
	article?: unknown[]
}

/** Подсказка шапки: категории, бренды и артикулы под введённый текст. */
export const autocomplete = (query: string, token: string): Promise<Autocomplete> =>
	call(`search-microservice/v1/autocomplete/search?${new URLSearchParams({ type: "3", query })}`, { token })

/**
 * Товары внутри категории. Единственная ручка armtek, которая умеет фильтр по
 * машине: `linkingTargetId` — идентификатор модификации TecDoc, `linkingTargetType`
 * — «P» для легковых. Свободный поиск такие поля отбивает четырёхсотым, см.
 * notes/providers-v2.md.
 */
export const searchByCategory = (q: {
	categoryAlias: string
	page?: number
	vkorg?: string
	vstel?: string
	linkingTargetId?: number
	linkingTargetType?: string
}, token: string): Promise<SearchData<RawArticle>> => {
	const vkorg = q.vkorg ?? DEFAULT_VKORG
	return call("search-microservice/v1/search/by-category", {
		token,
		vkorg,
		body: {
			query: q.categoryAlias,
			page: q.page ?? 1,
			typeView: "list",
			userInfo: { VKORG: vkorg, VSTELS_LIST: [q.vstel ?? DEFAULT_VSTEL] },
			...(q.linkingTargetId ? { linkingTargetId: q.linkingTargetId, linkingTargetType: q.linkingTargetType ?? "P" } : {}),
		},
	})
}

// --- отзывы ---------------------------------------------------------------

export type RawReview = {
	id: number
	text: string
	rating: number
	artId: number
	published?: boolean
	firstName?: string
	middleName?: string
	lastName?: string
	/** Телефон автора. Наружу не отдаём никогда. */
	createdUser?: string
	createdDate?: string
	changedDate?: string
	files?: { images?: unknown[] }[]
}

export type RawReviewRating = {
	artId: number
	reviewCount: number
	rating: string
	fiveStarsCount: number
	fourStarsCount: number
	threeStarsCount: number
	twoStarsCount: number
	oneStarsCount: number
	active?: boolean
}

export const reviewsByArtId = (artId: number, token: string, opts: { page?: number; limit?: number } = {}): Promise<{ paginator: Pagination; items: RawReview[] }> =>
	call(`review-microservice/v2/review/get-list-by-artid?${new URLSearchParams({
		artId: String(artId),
		page: String(opts.page ?? 1),
		limit: String(opts.limit ?? 20),
		published: "true",
		"order[changedDate]": "DESC",
	})}`, { token })

export const reviewRating = (artId: number, token: string): Promise<RawReviewRating[]> =>
	call(`review-microservice/v2/review/get-rating-by-artids?artids[]=${artId}`, { token })

// --- корзина --------------------------------------------------------------

export type RawCartItem = {
	posnr: number
	artid: number
	keyzak: string
	parnr: number
	kwmeng: number
	prices: number
	prices1?: string
	pricep?: string
	waers: string
	numZak: string
	dateDel?: string
	timeDel?: string
	orddt?: string
	vstels?: string
	zzsign?: string
	charg?: string
	status?: string
	comments?: string
	minbm?: number
	rvalue?: string
	saleCode?: number
	brand?: string
	pin?: string
	name?: string
	brandAlias?: string
	articleAlias?: string
	photo?: string[]
}

export type RawCart = { items: RawCartItem[]; codes: unknown[] }

/** Позиция в теле POST/PUT корзины. Числа тут именно числа, не строки. */
export type CartWriteItem = {
	keyzak: string
	parnr: number
	artid: number
	kwmeng: number
	numZak: string
	prices: number
	pricem: number
	waers: string
	vstels: string
	charg: string
	zzsign: string
	comments: string
	podbor: string
	status: string
	saleCode: number
	parentPosnr: number | null
	parentArtid: number | null
	posnr: number
}

export type CartWriteResult = { items: { vbeln?: number; posnr: number; artid: number; keyzak: string; kwmeng: number }[] }

export const cartState = (token: string, opts: { vstel: string; vkorg: string; category?: string; segment?: string }): Promise<RawCart> => {
	const q = new URLSearchParams({ "vstels[]": opts.vstel })
	if (opts.category) q.set("clientCategory", opts.category)
	if (opts.segment) q.set("clientSegment", opts.segment)
	return call(`cart-microservice/v1/base?${q}`, { token, vkorg: opts.vkorg })
}

export const cartCount = (token: string, vkorg: string): Promise<{ count: number; items: { artid: number; posnr: number; keyzak: string; kwmeng: number }[] }> =>
	call(`cart-microservice/v1/cart/items-total-count?vkorg=${encodeURIComponent(vkorg)}`, { token, vkorg })

/** POST добавляет новую позицию; по существующему posnr сайт отвечает 400. */
export const cartAdd = (token: string, vkorg: string, items: CartWriteItem[]): Promise<CartWriteResult> =>
	call("cart-microservice/v1/base", { token, vkorg, method: "POST", body: { vkorg, items } })

/** PUT меняет уже лежащую позицию: posnr обязателен. */
export const cartUpdate = (token: string, vkorg: string, items: CartWriteItem[]): Promise<CartWriteResult> =>
	call("cart-microservice/v1/base", { token, vkorg, method: "PUT", body: { vkorg, items } })

export const cartDelete = (token: string, vkorg: string, posnr: number[]): Promise<boolean> =>
	call("cart-microservice/v1/base", { token, vkorg, method: "DELETE", body: { vkorg, posnr } })

// --- гараж ----------------------------------------------------------------

export type RawTransportField = { value?: string } | undefined

export type RawTransport = {
	transportId?: number | string
	active?: string
	brand?: RawTransportField
	model_name?: RawTransportField
	manufacture_year?: RawTransportField
	modification?: RawTransportField
	vin?: RawTransportField
	vin_verified?: string
	license_plate_number?: string
	options?: { key?: string; value?: string }[]
	additional?: { garage_type_id?: string; garage_type_title?: string }
	images?: { baseImageUrl?: string }[]
}

export type RawGarage = { garageTypes?: unknown[]; transportList?: RawTransport[]; collectionList?: { data?: unknown[] } }

export const garageList = (token: string, clientId: string, vkorg: string): Promise<RawGarage> =>
	call(`task-selection-microservice/v1/garage/get-transport-list-by-filter?client_id=${encodeURIComponent(clientId)}`, { token, vkorg })

export type RawVstel = {
	vstel: string
	vname?: string
	adress?: string
	phone?: string
	remark?: string
	typobj?: string
	vkorg?: number
	geolat?: string
	geolon?: string
	isActive?: boolean
}

// --- заказы ---------------------------------------------------------------

export type RawOrderItem = {
	ARTID?: number
	PIN?: string
	BRAND?: string
	NAME?: string
	ARTICLE_NAME?: string
	ARTICLE_ALIAS?: string
	KWMENG?: number | string
	PRICE?: number | string
	NETWR?: number | string
	POSITION_STATUS?: string
	CHARG?: string
}

export type RawOrder = {
	VBELN?: string | number
	GUID?: string
	date?: string
	ORDER_DATE?: string
	CREDT?: string
	ORDER_STATUS?: string
	ORDER_STATUS_ALIAS?: string
	NETWR?: number | string
	PAYMENT_STATUS?: string
	PAYMENT_TYPE?: string
	ITEMS?: RawOrderItem[]
}

export type RawOrders = { KEY?: string; PAGE?: number; ORDER?: RawOrder[] }

/**
 * Список заказов. Дат не шлём: по отдельности `dateFrom` и `dateTo` сервер
 * принимает, а любую их пару отбивает «Значение не является правильной датой»
 * — проверено живьём, см. notes/providers-v2.md.
 */
export const orderReport = (token: string, vkorg: string, page = 1): Promise<RawOrders> =>
	call(`order-microservice/v1/order/report?${new URLSearchParams({ page: String(page) })}`, { token, vkorg })

// --- точки выдачи ---------------------------------------------------------

export const vstelList = (token: string, search = ""): Promise<{ paginator: Pagination; items: RawVstel[] }> =>
	call(`delivery-microservice/v1/custom-vstel/list?${new URLSearchParams({ search, viewAll: "true" })}`, { token })

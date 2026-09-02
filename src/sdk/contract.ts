// contract.ts — контракт провайдера v1. Единственный источник правды по формам
// ответов — docs/contract.md; здесь то же самое типами. Агрегатор импортирует
// отсюда только типы.

export const CONTRACT_VERSION = 1 as const

export type Capability = "reviews" | "garage" | "analogs" | "basket" | "orders"

export type Rating = { average: number; count: number }

/** Поля как их отдаёт сайт: ни провайдер, ни рендер их не маскируют. */
export type Display = { name: string; email?: string; phone?: string }

/** Результат поиска по названию. */
export type Product = {
	article: string
	brand: string
	name: string
	price?: number
	currency?: "RUB"
	quantity?: number
	rating?: Rating
	images?: string[]
	url?: string
	category?: string
	extra?: Record<string, unknown>
}

/** Кто выпускает артикул. `brand` — ключ склейки между сайтами. */
export type BrandHit = {
	brand: string
	article: string
	name?: string
	rating?: Rating
	images?: string[]
	url?: string // карточка этого артикула у этого бренда на сайте
	extra?: Record<string, unknown>
}

export type Offer = {
	article: string
	brand: string
	name?: string
	price: number
	currency: "RUB"
	quantity?: number
	deliveryDays?: number
	deliveryDate?: string // YYYY-MM-DD
	seller?: string
	stock?: { code: string; name?: string }
	rating?: Rating
	images?: string[]
	url?: string
	ref?: Record<string, unknown> // что нужно сайту для basket add; обязателен при capability basket
	analog?: boolean
	analogOf?: { article: string; brand: string }
	extra?: Record<string, unknown>
}

export type Review = {
	author?: string
	date?: string // YYYY-MM-DD
	rating?: number // 1..5
	pros?: string
	cons?: string
	text: string
	purchased?: boolean
	url?: string // сам отзыв, если сайт его адресует
}

export type Reviews = {
	total: number
	rating?: Rating & { histogram?: number[] } // от 5★ к 1★
	summary?: { pros: string[]; cons: string[] }
	items: Review[]
	url?: string // страница отзывов на сайте
}

/** Карточка товара: то, что сайт показывает до перехода к предложениям. */
export type Info = {
	article: string
	brand: string
	name: string
	url?: string // карточка на сайте
	rating?: Rating & { histogram?: number[] } // от 5★ к 1★
	images?: string[]
	price?: number // «от», если сайт её даёт
	currency?: "RUB"
	deliveryDays?: number // минимальный срок, если сайт его даёт
	stock?: { code: string; name?: string; quantity?: number }[]
	description?: string
	extra?: Record<string, unknown>
}

export type BasketItem = {
	id: string
	article: string
	brand: string
	name?: string
	price: number
	quantity: number
	sum?: number
	seller?: string
	deliveryDays?: number
	deliveryDate?: string
	url?: string // карточка товара этой позиции
	extra?: Record<string, unknown>
}

export type Basket = {
	items: BasketItem[]
	total?: number
	currency: "RUB"
	url?: string
}

export type Car = {
	brand: string
	model: string
	modification?: string
	year?: number
	engine?: string
	vin?: string
	odometer?: number
	ref: Record<string, unknown>
}

export type OrderItem = {
	article: string
	brand: string
	name: string
	qty: number
	price: number
	sum?: number
	url?: string
}

export type Order = {
	id: string
	date: string // ISO
	status: string
	total: number
	currency: string
	url?: string
	items?: OrderItem[]
	extra?: Record<string, unknown>
}

export type Command = { name: string; usage: string; about: string; auth: boolean }

export type Describe = {
	contract: typeof CONTRACT_VERSION
	id: string
	name: string
	site: string
	capabilities: Capability[]
	commands: Command[]
}

export type ErrorCode = "auth" | "http" | "notfound" | "tty" | "timeout" | "bad_args" | "internal" | "ambiguous"
export type ErrorBody = { error: { code: ErrorCode; message: string; items?: BrandHit[] } }

export type LoginResult = { account: unknown; display: Display }
export type WhoamiResult = { ok: boolean; display?: Display }
/** `extra` — провайдерское расширение (у autodoc — список найденных категорий). */
export type SearchResult = { items: Product[]; total?: number; extra?: Record<string, unknown> }
export type BrandsResult = { items: BrandHit[] }
export type OffersResult = { items: Offer[] }
export type CarsResult = { cars: Car[] }
export type InfoResult = { info: Info }
export type OrdersResult = { items: Order[] }

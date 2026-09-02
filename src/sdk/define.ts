// define.ts — объявление провайдера. Типы делают контракт обязательным:
// пропущенный offers или reviews при capability "reviews" — ошибка компиляции.

import type {
	Basket, BrandsResult, Capability, CarsResult, Display, FitsResult, InfoResult,
	OffersResult, OrdersResult, Reviews, SearchResult,
} from "./contract.ts"
import type { Flags } from "./cli.ts"
import type { ErrorMapper } from "./errors.ts"

export type Ctx<A> = {
	account: A | null
	saveAccount(a: A | null): Promise<void>
	json: boolean
	flags: Flags
	page: number
	limit: number
	prompt(q: string): Promise<string>
	secret(q: string): Promise<string>
	warn(msg: string): void
}

export type CommandResult = { json: unknown; render?: () => string }

export type ProviderCommand<A> = {
	usage: string
	about: string
	auth: boolean
	run(ctx: Ctx<A>, args: string[]): Promise<CommandResult>
}

export type BasketOps<A> = {
	list(ctx: Ctx<A>): Promise<Basket>
	add(ctx: Ctx<A>, ref: Record<string, unknown>, qty: number): Promise<Basket>
	set(ctx: Ctx<A>, itemId: string, qty: number): Promise<Basket>
	remove(ctx: Ctx<A>, itemId: string): Promise<Basket>
}

/**
 * Что знает поиск сверх текста. `car` — ref машины из `garage export` этого же
 * провайдера, как его отдал сам провайдер; `null` — искать без машины.
 * Провайдер, который так не умеет, обязан сказать это через `ctx.warn` и
 * ответить обычной выдачей, а не ошибкой.
 */
export type SearchOpts = { car: Record<string, unknown> | null }

export type ProviderBase<A> = {
	id: string
	name: string
	site: string
	/** Флаги своих команд, которые принимают значение (контрактные добавляются сами). */
	valueFlags?: string[]
	mapError?: ErrorMapper

	login(ctx: Ctx<A>): Promise<{ account: A; display: Display }>
	whoami(ctx: Ctx<A>): Promise<Display | null>
	search(ctx: Ctx<A>, text: string, opts: SearchOpts): Promise<SearchResult>
	brands(ctx: Ctx<A>, article: string): Promise<BrandsResult>
	offers(ctx: Ctx<A>, article: string, brand: string, opts: { analogs: boolean }): Promise<OffersResult>
	info(ctx: Ctx<A>, article: string, brand: string): Promise<InfoResult>
	/** Только аналоги, без точных совпадений. Не умеет — пустой список и ctx.warn. */
	analogs(ctx: Ctx<A>, article: string, brand: string): Promise<OffersResult>

	/**
	 * Применимость к машине: `car` — ref из `garage export` этого же сайта,
	 * как его отдал сам сайт. Провайдер, который применимости не знает, эту
	 * команду не объявляет вовсе — притворяться «не подходит» ему нечем.
	 */
	fits?(ctx: Ctx<A>, article: string, brand: string, opts: { car: Record<string, unknown> }): Promise<FitsResult>
	reviews?(ctx: Ctx<A>, article: string, brand: string): Promise<Reviews>
	garageExport?(ctx: Ctx<A>): Promise<CarsResult>
	orders?(ctx: Ctx<A>): Promise<OrdersResult>
	basket?: BasketOps<A>
	commands?: Record<string, ProviderCommand<A>>
}

// Обязательства из capabilities: объявил — реализуй. Пустое пересечение
// ничего не требует, поэтому провайдер без capability платит только за своё.
type Requires<A, C extends Capability> =
	("reviews" extends C ? { reviews: NonNullable<ProviderBase<A>["reviews"]> } : {}) &
	("garage" extends C ? { garageExport: NonNullable<ProviderBase<A>["garageExport"]> } : {}) &
	("orders" extends C ? { orders: NonNullable<ProviderBase<A>["orders"]> } : {}) &
	("fits" extends C ? { fits: NonNullable<ProviderBase<A>["fits"]> } : {}) &
	("basket" extends C ? { basket: BasketOps<A> } : {})

export type ProviderSpec<A> = ProviderBase<A> & { capabilities: Capability[] }

export function defineProvider<A, const C extends readonly Capability[]>(
	spec: ProviderBase<A> & { capabilities: C } & Requires<A, C[number]>,
): ProviderSpec<A> {
	// Проверка и в рантайме — для провайдера, собранного без typecheck
	for (const cap of spec.capabilities) {
		const has = cap === "reviews" ? !!spec.reviews
			: cap === "garage" ? !!spec.garageExport
			: cap === "orders" ? !!spec.orders
			: cap === "fits" ? !!spec.fits
			: cap === "basket" ? !!spec.basket
			: true
		if (!has) throw new Error(`провайдер ${spec.id} объявил capability ${cap}, но не реализовал её`)
	}
	// info и analogs обязательны для всех: агрегатор зовёт их без оглядки на
	// capabilities, и провайдер без них уронил бы общую выдачу на пустом месте.
	for (const m of ["search", "brands", "offers", "info", "analogs"] as const) {
		if (typeof spec[m] !== "function") throw new Error(`провайдер ${spec.id} не реализовал обязательную команду ${m}`)
	}
	return { ...spec, capabilities: [...spec.capabilities] }
}

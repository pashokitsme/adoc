// define.ts — объявление провайдера. Типы делают контракт обязательным:
// пропущенный offers или reviews при capability "reviews" — ошибка компиляции.

import type { Basket, BrandsResult, Capability, CarsResult, Display, OffersResult, Reviews, SearchResult } from "./contract.ts"
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

export type ProviderBase<A> = {
	id: string
	name: string
	site: string
	/** Флаги своих команд, которые принимают значение (контрактные добавляются сами). */
	valueFlags?: string[]
	mapError?: ErrorMapper

	login(ctx: Ctx<A>): Promise<{ account: A; display: Display }>
	whoami(ctx: Ctx<A>): Promise<Display | null>
	search(ctx: Ctx<A>, text: string): Promise<SearchResult>
	brands(ctx: Ctx<A>, article: string): Promise<BrandsResult>
	offers(ctx: Ctx<A>, article: string, brand: string, opts: { analogs: boolean }): Promise<OffersResult>

	reviews?(ctx: Ctx<A>, article: string, brand: string): Promise<Reviews>
	garageExport?(ctx: Ctx<A>): Promise<CarsResult>
	basket?: BasketOps<A>
	commands?: Record<string, ProviderCommand<A>>
}

// Обязательства из capabilities: объявил — реализуй. Пустое пересечение
// ничего не требует, поэтому провайдер без capability платит только за своё.
type Requires<A, C extends Capability> =
	("reviews" extends C ? { reviews: NonNullable<ProviderBase<A>["reviews"]> } : {}) &
	("garage" extends C ? { garageExport: NonNullable<ProviderBase<A>["garageExport"]> } : {}) &
	("basket" extends C ? { basket: BasketOps<A> } : {})

export type ProviderSpec<A> = ProviderBase<A> & { capabilities: Capability[] }

export function defineProvider<A, const C extends readonly Capability[]>(
	spec: ProviderBase<A> & { capabilities: C } & Requires<A, C[number]>,
): ProviderSpec<A> {
	// Проверка и в рантайме — для провайдера, собранного без typecheck
	for (const cap of spec.capabilities) {
		const has = cap === "reviews" ? !!spec.reviews : cap === "garage" ? !!spec.garageExport : cap === "basket" ? !!spec.basket : true
		if (!has) throw new Error(`провайдер ${spec.id} объявил capability ${cap}, но не реализовал её`)
	}
	return { ...spec, capabilities: [...spec.capabilities] }
}

// validate.ts — форма ответов провайдера. Провайдер — чужой процесс, возможно
// на другом языке: всё, что от него пришло, проверяется до использования,
// иначе `undefined.map` вылезал бы посреди таблицы. Ошибка — internal с именем
// провайдера: виноват он, а не пользователь.

import { CONTRACT_VERSION, ProviderError } from "../sdk/index.ts"
import type { Basket, BasketItem, BrandHit, Capability, Car, Command, Describe, Display, Info, Offer, Order, OrderItem, Product, Rating, Review, Reviews, WhoamiResult } from "../sdk/index.ts"

const CAPABILITIES: Capability[] = ["reviews", "garage", "analogs", "basket", "orders"]

const fail = (who: string, what: string): never => {
	throw new ProviderError("internal", `${who}: ${what}`)
}

const obj = (v: unknown, who: string, what: string): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail(who, `${what} — не объект`)

const arr = (v: unknown, who: string, what: string): unknown[] =>
	Array.isArray(v) ? v : fail(who, `${what} — не массив`)

const str = (o: Record<string, unknown>, k: string, who: string): string =>
	typeof o[k] === "string" && o[k] !== "" ? o[k] : fail(who, `нет поля ${k}`)

const optStr = (o: Record<string, unknown>, k: string): string | undefined =>
	typeof o[k] === "string" && o[k] !== "" ? o[k] : undefined

const num = (o: Record<string, unknown>, k: string, who: string): number =>
	typeof o[k] === "number" && Number.isFinite(o[k]) ? o[k] : fail(who, `нет числового поля ${k}`)

const optNum = (o: Record<string, unknown>, k: string): number | undefined =>
	typeof o[k] === "number" && Number.isFinite(o[k]) ? o[k] : undefined

const optBool = (o: Record<string, unknown>, k: string): boolean | undefined =>
	typeof o[k] === "boolean" ? o[k] : undefined

const optObj = (o: Record<string, unknown>, k: string): Record<string, unknown> | undefined =>
	o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ? o[k] as Record<string, unknown> : undefined

const optStrings = (o: Record<string, unknown>, k: string): string[] | undefined =>
	Array.isArray(o[k]) ? o[k].filter((x): x is string => typeof x === "string") : undefined

function optRating(o: Record<string, unknown>): Rating | undefined {
	const r = optObj(o, "rating")
	if (!r) return undefined
	const average = optNum(r, "average"), count = optNum(r, "count")
	return average === undefined || count === undefined ? undefined : { average, count }
}

export function parseDescribe(v: unknown, id: string): Describe {
	const who = id
	const o = obj(v, who, "describe")
	// Порядок проверок — от главного к частному: сначала версия и опознание,
	// потом обязательные поля карточки, и только потом список команд. Иначе
	// провайдер без name узнавал бы о себе, что у него «commands — не массив».
	if (o.contract !== CONTRACT_VERSION) fail(who, `контракт версии ${String(o.contract)}, а обёртка знает ${CONTRACT_VERSION}`)
	if (str(o, "id", who) !== id) fail(who, `id в describe — «${String(o.id)}», а бинарь зовётся «${id}»`)
	const name = str(o, "name", who)
	const site = str(o, "site", who)
	// Незнакомая capability — это провайдер новее обёртки, а не поломка:
	// молча отбрасываем, всё известное продолжает работать.
	const capabilities = arr(o.capabilities, who, "capabilities").filter((c): c is Capability => CAPABILITIES.includes(c as Capability))
	const commands: Command[] = arr(o.commands, who, "commands").map(c => {
		const x = obj(c, who, "команда")
		return { name: str(x, "name", who), usage: str(x, "usage", who), about: optStr(x, "about") ?? "", auth: x.auth === true }
	})
	return { contract: CONTRACT_VERSION, id, name, site, capabilities, commands }
}

export function parseDisplay(v: unknown, who: string): Display {
	const o = obj(v, who, "display")
	return { name: str(o, "name", who), ...(optStr(o, "email") ? { email: optStr(o, "email") } : {}), ...(optStr(o, "phone") ? { phone: optStr(o, "phone") } : {}) }
}

export function parseWhoami(v: unknown, who: string): WhoamiResult {
	const o = obj(v, who, "whoami")
	const ok = o.ok === true
	return ok ? { ok, display: parseDisplay(o.display, who) } : { ok: false }
}

const parseBrandHit = (v: unknown, who: string): BrandHit => {
	const o = obj(v, who, "элемент brands")
	return {
		brand: str(o, "brand", who), article: str(o, "article", who),
		...(optStr(o, "name") ? { name: optStr(o, "name") } : {}),
		...(optRating(o) ? { rating: optRating(o) } : {}),
		...(optStr(o, "url") ? { url: optStr(o, "url") } : {}),
		...(optObj(o, "extra") ? { extra: optObj(o, "extra") } : {}),
	}
}

export const parseBrands = (v: unknown, who: string): BrandHit[] =>
	arr(obj(v, who, "ответ brands").items, who, "items").map(x => parseBrandHit(x, who))

/** Одна строка предложения: её же читает карточка `info`, где цены идут под ней. */
function parseOffer(x: unknown, who: string): Offer {
	const o = obj(x, who, "предложение")
	return {
		article: str(o, "article", who), brand: str(o, "brand", who), price: num(o, "price", who),
		currency: "RUB",
		...(optStr(o, "name") ? { name: optStr(o, "name") } : {}),
		...(optNum(o, "quantity") !== undefined ? { quantity: optNum(o, "quantity") } : {}),
		...(optNum(o, "deliveryDays") !== undefined ? { deliveryDays: optNum(o, "deliveryDays") } : {}),
		...(optStr(o, "deliveryDate") ? { deliveryDate: optStr(o, "deliveryDate") } : {}),
		...(optStr(o, "seller") ? { seller: optStr(o, "seller") } : {}),
		...(optRating(o) ? { rating: optRating(o) } : {}),
		...(optStr(o, "url") ? { url: optStr(o, "url") } : {}),
		...(optObj(o, "ref") ? { ref: optObj(o, "ref") } : {}),
		...(optBool(o, "analog") !== undefined ? { analog: optBool(o, "analog") } : {}),
		...(optObj(o, "extra") ? { extra: optObj(o, "extra") } : {}),
	}
}

/**
 * Предложения вместе с итогом сайта: `total` — сколько их у него всего, а не
 * сколько приехало страницей. Сайт его не назвал — обёртка считает по своей
 * склейке, врать про «из 43», когда их 575, нельзя.
 */
export function parseOffers(v: unknown, who: string): { items: Offer[]; total?: number } {
	const body = obj(v, who, "ответ offers")
	const items: Offer[] = arr(body.items, who, "items").map(x => parseOffer(x, who))
	return { items, ...(optNum(body, "total") !== undefined ? { total: optNum(body, "total") } : {}) }
}

/** То же и для поиска: `total` — сколько сайт нашёл всего, а не сколько отдал. */
export function parseProducts(v: unknown, who: string): { items: Product[]; total?: number } {
	const body = obj(v, who, "ответ search")
	const items = arr(body.items, who, "items").map(x => {
		const o = obj(x, who, "товар")
		return {
			article: str(o, "article", who), brand: str(o, "brand", who), name: optStr(o, "name") ?? "",
			...(optNum(o, "price") !== undefined ? { price: optNum(o, "price") } : {}),
			...(optNum(o, "quantity") !== undefined ? { quantity: optNum(o, "quantity") } : {}),
			...(optRating(o) ? { rating: optRating(o) } : {}),
			...(optStr(o, "url") ? { url: optStr(o, "url") } : {}),
			...(optStr(o, "category") ? { category: optStr(o, "category") } : {}),
			...(optObj(o, "extra") ? { extra: optObj(o, "extra") } : {}),
		}
	})
	return { items, ...(optNum(body, "total") !== undefined ? { total: optNum(body, "total") } : {}) }
}

export function parseReviews(v: unknown, who: string): Reviews {
	const o = obj(v, who, "ответ reviews")
	const r = optObj(o, "rating")
	const items: Review[] = arr(o.items, who, "items").map(x => {
		const it = obj(x, who, "отзыв")
		return {
			text: optStr(it, "text") ?? "",
			...(optStr(it, "author") ? { author: optStr(it, "author") } : {}),
			...(optStr(it, "date") ? { date: optStr(it, "date") } : {}),
			...(optNum(it, "rating") !== undefined ? { rating: optNum(it, "rating") } : {}),
			...(optStr(it, "pros") ? { pros: optStr(it, "pros") } : {}),
			...(optStr(it, "cons") ? { cons: optStr(it, "cons") } : {}),
			...(optBool(it, "purchased") !== undefined ? { purchased: optBool(it, "purchased") } : {}),
			...(optStr(it, "url") ? { url: optStr(it, "url") } : {}),
		}
	})
	const rating = r && optNum(r, "average") !== undefined && optNum(r, "count") !== undefined
		? { average: optNum(r, "average")!, count: optNum(r, "count")!, ...(Array.isArray(r.histogram) ? { histogram: r.histogram.filter((n): n is number => typeof n === "number") } : {}) }
		: undefined
	const summary = optObj(o, "summary")
	return {
		total: optNum(o, "total") ?? items.length,
		...(rating ? { rating } : {}),
		...(summary ? { summary: { pros: optStrings(summary, "pros") ?? [], cons: optStrings(summary, "cons") ?? [] } } : {}),
		...(optStr(o, "url") ? { url: optStr(o, "url") } : {}),
		items,
	}
}

export function parseBasket(v: unknown, who: string): Basket {
	const o = obj(v, who, "корзина")
	const items: BasketItem[] = arr(o.items, who, "items").map(x => {
		const it = obj(x, who, "позиция корзины")
		return {
			id: str(it, "id", who), article: str(it, "article", who), brand: str(it, "brand", who),
			price: num(it, "price", who), quantity: num(it, "quantity", who),
			...(optStr(it, "name") ? { name: optStr(it, "name") } : {}),
			...(optNum(it, "sum") !== undefined ? { sum: optNum(it, "sum") } : {}),
			...(optStr(it, "seller") ? { seller: optStr(it, "seller") } : {}),
			...(optNum(it, "deliveryDays") !== undefined ? { deliveryDays: optNum(it, "deliveryDays") } : {}),
			...(optStr(it, "deliveryDate") ? { deliveryDate: optStr(it, "deliveryDate") } : {}),
			...(optStr(it, "url") ? { url: optStr(it, "url") } : {}),
		}
	})
	return { items, currency: "RUB", ...(optNum(o, "total") !== undefined ? { total: optNum(o, "total") } : {}), ...(optStr(o, "url") ? { url: optStr(o, "url") } : {}) }
}

export function parseCars(v: unknown, who: string): Car[] {
	return arr(obj(v, who, "ответ garage export").cars, who, "cars").map(x => {
		const c = obj(x, who, "машина")
		return {
			brand: str(c, "brand", who), model: str(c, "model", who), ref: optObj(c, "ref") ?? {},
			...(optStr(c, "modification") ? { modification: optStr(c, "modification") } : {}),
			...(optNum(c, "year") !== undefined ? { year: optNum(c, "year") } : {}),
			...(optStr(c, "engine") ? { engine: optStr(c, "engine") } : {}),
			...(optStr(c, "vin") ? { vin: optStr(c, "vin") } : {}),
			...(optNum(c, "odometer") !== undefined ? { odometer: optNum(c, "odometer") } : {}),
		}
	})
}

/**
 * Карточка артикула: почти всё в ней необязательно — сайты показывают разное,
 * и требовать от каждого цену со сроком значило бы забраковать половину
 * честных ответов. Обязателен только сам предмет разговора: артикул и бренд.
 */
export function parseInfo(v: unknown, who: string): { info: Info; offers: Offer[] } {
	const body = obj(v, who, "ответ info")
	const o = obj(body.info, who, "info")
	// Предложений может и не быть: сайт, который их к карточке не даёт, отдаёт
	// одну карточку, и это не повод забраковать ответ целиком.
	const offers = body.offers === undefined ? [] : arr(body.offers, who, "offers").map(x => parseOffer(x, who))
	const r = optObj(o, "rating")
	const rating = r && optNum(r, "average") !== undefined && optNum(r, "count") !== undefined
		? {
			average: optNum(r, "average")!, count: optNum(r, "count")!,
			...(Array.isArray(r.histogram) ? { histogram: r.histogram.filter((n): n is number => typeof n === "number") } : {}),
		}
		: undefined
	const stock: NonNullable<Info["stock"]> = arr(o.stock ?? [], who, "stock").flatMap(x => {
		const s = x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : undefined
		if (!s) return []
		const code = optStr(s, "code")
		// Склад без кода — не склад: показать его нечем, а падать из-за одной
		// строки наличия, когда есть остальная карточка, незачем.
		return code === undefined ? [] : [{
			code,
			...(optStr(s, "name") ? { name: optStr(s, "name") } : {}),
			...(optNum(s, "quantity") !== undefined ? { quantity: optNum(s, "quantity") } : {}),
			...(optNum(s, "deliveryDays") !== undefined ? { deliveryDays: optNum(s, "deliveryDays") } : {}),
		}]
	})
	const info: Info = {
		article: str(o, "article", who), brand: str(o, "brand", who), name: optStr(o, "name") ?? "",
		...(optStr(o, "url") ? { url: optStr(o, "url") } : {}),
		...(rating ? { rating } : {}),
		...(optStrings(o, "images") ? { images: optStrings(o, "images") } : {}),
		...(optNum(o, "price") !== undefined ? { price: optNum(o, "price") } : {}),
		// Валюта у контракта одна: другой цены агрегатор всё равно не покажет.
		...(optStr(o, "currency") ? { currency: "RUB" as const } : {}),
		...(optNum(o, "deliveryDays") !== undefined ? { deliveryDays: optNum(o, "deliveryDays") } : {}),
		...(stock.length ? { stock } : {}),
		...(optStr(o, "description") ? { description: optStr(o, "description") } : {}),
		...(optObj(o, "extra") ? { extra: optObj(o, "extra") } : {}),
	}
	return { info, offers }
}

/** Заказы сайта. Позиции необязательны: их отдают не все. */
export function parseOrders(v: unknown, who: string): Order[] {
	return arr(obj(v, who, "ответ orders").items, who, "items").map(x => {
		const o = obj(x, who, "заказ")
		const items: OrderItem[] | undefined = Array.isArray(o.items)
			? o.items.map(y => {
				const it = obj(y, who, "позиция заказа")
				return {
					article: str(it, "article", who), brand: str(it, "brand", who), name: optStr(it, "name") ?? "",
					qty: num(it, "qty", who), price: num(it, "price", who),
					...(optNum(it, "sum") !== undefined ? { sum: optNum(it, "sum") } : {}),
					...(optStr(it, "url") ? { url: optStr(it, "url") } : {}),
				}
			})
			: undefined
		return {
			id: str(o, "id", who), date: optStr(o, "date") ?? "", status: optStr(o, "status") ?? "",
			total: optNum(o, "total") ?? 0, currency: optStr(o, "currency") ?? "RUB",
			...(optStr(o, "url") ? { url: optStr(o, "url") } : {}),
			...(items ? { items } : {}),
			...(optObj(o, "extra") ? { extra: optObj(o, "extra") } : {}),
		}
	})
}

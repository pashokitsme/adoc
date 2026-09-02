// validate.ts — форма ответов провайдера. Провайдер — чужой процесс, возможно
// на другом языке: всё, что от него пришло, проверяется до использования,
// иначе `undefined.map` вылезал бы посреди таблицы. Ошибка — internal с именем
// провайдера: виноват он, а не пользователь.

import { CONTRACT_VERSION, ProviderError } from "../sdk/index.ts"
import type { Basket, BasketItem, BrandHit, Capability, Car, Command, Describe, Display, Offer, Product, Rating, Review, Reviews, WhoamiResult } from "../sdk/index.ts"

const CAPABILITIES: Capability[] = ["reviews", "garage", "analogs", "basket"]

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
		...(optObj(o, "extra") ? { extra: optObj(o, "extra") } : {}),
	}
}

export const parseBrands = (v: unknown, who: string): BrandHit[] =>
	arr(obj(v, who, "ответ brands").items, who, "items").map(x => parseBrandHit(x, who))

export function parseOffers(v: unknown, who: string): Offer[] {
	return arr(obj(v, who, "ответ offers").items, who, "items").map(x => {
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
	})
}

export function parseProducts(v: unknown, who: string): Product[] {
	return arr(obj(v, who, "ответ search").items, who, "items").map(x => {
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

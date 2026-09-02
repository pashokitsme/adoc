// Разбор ответов armtek на записанных фикстурах. Сети здесь нет: фикстуры —
// это реальные ответы прода от 2026-09-02, вычищенные от личного.

import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { errorTexts, mapHttpError } from "../../src/providers/armtek/api.ts"
import { decodeClaims, displayOf, expiresOf, placeOf, type ClientData } from "../../src/providers/armtek/auth.ts"
import { HttpError, ProviderError } from "../../src/sdk/index.ts"

const DIR = join(import.meta.dir, "..", "fixtures", "armtek")
const fixture = async <T = any>(name: string): Promise<T> => await Bun.file(join(DIR, name)).json() as T

/** Ключ склейки: PIN приходит в форматировании производителя, «0 986 452 041». */
const norm = (s: string): string => s.replace(/[^0-9a-zA-Zа-яА-Я]/g, "").toUpperCase()

describe("ошибки", () => {
	test("401 — это auth, а не http: агрегатору нужен «нужен вход»", async () => {
		const body = JSON.stringify(await fixture("error-validation.json"))
		const e = mapHttpError(new HttpError(401, "https://armtek.ru/rest/ru/x", body))
		expect(e).toBeInstanceOf(ProviderError)
		expect(e!.code).toBe("auth")
	})

	test("остальные статусы — http, с текстом из конверта", async () => {
		const body = JSON.stringify(await fixture("error-validation.json"))
		const e = mapHttpError(new HttpError(400, "https://armtek.ru/rest/ru/x", body))
		expect(e!.code).toBe("http")
		expect(e!.message).toContain("[vkorg]")
	})

	test("401 с пустым arr_messages всё равно даёт внятный текст", () => {
		const e = mapHttpError(new HttpError(401, "https://armtek.ru/rest/ru/x", '{"data":null,"arr_messages":[]}'))
		expect(e!.code).toBe("auth")
		expect(e!.message.length).toBeGreaterThan(0)
	})

	test("чужая ошибка не подменяется", () => {
		expect(mapHttpError(new Error("боль"))).toBeNull()
	})

	test("не-ошибочные сообщения не считаются ошибками", () => {
		expect(errorTexts({ arr_messages: [{ type: "S", text: "готово" }] })).toEqual([])
		expect(errorTexts(null)).toEqual([])
	})
})

describe("клеймы токена", () => {
	const jwt = (claims: unknown): string =>
		`x.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.y`

	test("кириллица в клеймах не портится", () => {
		const c = decodeClaims(jwt({ exp: 42, data: { login: "Пётр" } }))
		expect(c?.data?.login).toBe("Пётр")
	})

	test("exp берётся из токена", () => {
		expect(expiresOf(jwt({ exp: 1788564238 }))).toBe(1788564238)
	})

	test("токен без exp живёт час, мусор не роняет разбор", () => {
		expect(expiresOf(jwt({}))).toBeGreaterThan(Math.floor(Date.now() / 1000))
		expect(decodeClaims("не-токен")).toBeNull()
	})
})

describe("карточка клиента", () => {
	test("whoami показывает имя, почту и телефон без маскирования", async () => {
		const c = (await fixture("client.json")).data as ClientData
		expect(displayOf(c, "-")).toEqual({
			name: "Иванов Иван Иванович",
			email: "ivanov@example.com",
			phone: "+79990000000",
		})
	})

	test("без имени показывается логин", () => {
		expect(displayOf({}, "79990000000").name).toBe("79990000000")
	})

	test("точка выдачи, организация и коды клиента берутся из карточки", async () => {
		const c = (await fixture("client.json")).data as ClientData
		expect(placeOf(c)).toEqual({ vkorg: "4000", vstel: "ME86", clientId: "<clientId>", category: "KR", segment: "51" })
	})

	test("в пустой карточке нечего перезаписывать", () => {
		expect(placeOf({})).toEqual({})
	})
})

describe("выдача поиска, typeView list", () => {
	test("строка — это пара (артикул, бренд), цены лежат в SUGGESTIONS", async () => {
		const f = await fixture("search-list.json")
		expect(f.data.typeView).toBe("list")
		expect(f.data.pagination.perPage).toBe(36)
		const a = f.data.articlesData[0]
		expect(norm(a.PIN)).toBe("0986452041")
		expect(a.BRAND).toBe("BOSCH")
		expect(typeof a.ARTID).toBe("number")
		const s = a.SUGGESTIONS[0]
		for (const k of ["PRICES1", "RVALUE", "DLVDT", "KEYZAK", "NUMZAK", "PARNR", "WAERS", "POSNR"]) {
			expect(s).toHaveProperty(k)
		}
	})

	test("остаток — строка и бывает «>20», числом его считать нельзя", async () => {
		const f = await fixture("search-list.json")
		const values = f.data.articlesData.flatMap((a: any) => a.SUGGESTIONS.map((s: any) => s.RVALUE))
		expect(values.every((v: unknown) => typeof v === "string")).toBe(true)
		expect(values.some((v: string) => !/^\d+$/.test(v))).toBe(true)
	})

	test("у одной строки бывает несколько предложений", async () => {
		const f = await fixture("search-list.json")
		expect(f.data.articlesData.some((a: any) => a.SUGGESTIONS.length > 1)).toBe(true)
	})

	test("бренды различаются внутри одного нормализованного артикула", async () => {
		const f = await fixture("search-brand-group.json")
		const pins = new Set(f.data.articlesData.map((a: any) => norm(a.PIN)))
		const brands = new Set(f.data.articlesData.map((a: any) => a.BRAND))
		expect(pins.size).toBe(1)
		expect(brands.size).toBeGreaterThan(2)
	})

	test("typeView card — другая форма: предложение слито с артикулом", async () => {
		const f = await fixture("search-card.json")
		expect(f.data.typeView).toBe("card")
		const a = f.data.articlesData[0]
		expect(a.SUGGESTIONS).toBeUndefined()
		expect(a).toHaveProperty("PRICES1")
		expect(a).toHaveProperty("KEYZAK")
	})
})

describe("отзывы", () => {
	test("лента: один текст и оценка, без плюсов и минусов", async () => {
		const f = await fixture("reviews-list.json")
		expect(f.data.paginator.totalCount).toBe(2)
		const r = f.data.items[0]
		expect(typeof r.text).toBe("string")
		expect(r.rating).toBeGreaterThanOrEqual(1)
		expect(r.rating).toBeLessThanOrEqual(5)
	})

	test("в фикстуре не осталось персональных данных автора", async () => {
		const f = await fixture("reviews-list.json")
		for (const r of f.data.items) {
			expect(r.createdUser).toBe("<login>")
			expect(r.firstName).toBe("<firstName>")
		}
	})

	test("рейтинг приходит готовой гистограммой от 5★ к 1★", async () => {
		const f = await fixture("reviews-rating.json")
		const r = f.data[0]
		expect(r.artId).toBe(55469)
		expect(Number(r.rating)).toBeCloseTo(5)
		const hist = [r.fiveStarsCount, r.fourStarsCount, r.threeStarsCount, r.twoStarsCount, r.oneStarsCount]
		expect(hist.reduce((a: number, b: number) => a + b, 0)).toBe(r.reviewCount)
	})
})

describe("корзина", () => {
	test("позиция несёт всё для показа: posnr, цену, количество, срок", async () => {
		const f = await fixture("cart-list.json")
		const i = f.data.items[0]
		for (const k of ["posnr", "artid", "keyzak", "kwmeng", "prices", "waers", "pin", "brand", "name", "dateDel", "articleAlias"]) {
			expect(i).toHaveProperty(k)
		}
		expect(i.waers).toBe("RUB")
	})

	test("итога в ответе нет — сумму считает клиент", async () => {
		const f = await fixture("cart-list.json")
		expect(Object.keys(f.data).sort()).toEqual(["codes", "items"])
	})

	test("POST и PUT возвращают только изменённые позиции", async () => {
		const add = await fixture("cart-add.json")
		const put = await fixture("cart-put.json")
		expect(add.data.items[0].posnr).toBe(1)
		expect(add.data.items[0].kwmeng).toBe(1)
		expect(put.data.items[0].posnr).toBe(1)
		expect(put.data.items[0].kwmeng).toBe(2)
	})

	test("DELETE отвечает голым true", async () => {
		expect((await fixture("cart-delete.json")).data).toBe(true)
	})
})

describe("точки выдачи", () => {
	test("vstel, город и сбытовая организация", async () => {
		const f = await fixture("vstel-list.json")
		const me = f.data.items.find((v: any) => v.vstel === "ME86")
		expect(me.vkorg).toBe(4000)
		expect(typeof me.vname).toBe("string")
	})
})

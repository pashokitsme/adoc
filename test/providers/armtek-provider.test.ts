// Контрактные команды провайдера целиком: маршрут запросов, коды ошибок и
// форма ответа. Сеть подменена швом setTransport, фикстуры — записанные ответы.

import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import * as api from "../../src/providers/armtek/api.ts"
import { emptyAccount, type Account } from "../../src/providers/armtek/auth.ts"
import { MAX_PAGES } from "../../src/providers/armtek/brand.ts"
import { armtek } from "../../src/providers/armtek/provider.ts"
import { ProviderError } from "../../src/sdk/index.ts"
import type { Ctx } from "../../src/sdk/define.ts"

const DIR = join(import.meta.dir, "..", "fixtures", "armtek")
const fixture = async <T = any>(name: string): Promise<T> => await Bun.file(join(DIR, name)).json() as T

type Call = { url: string; method: string; body: any }

/** Маршрутизация по куску пути; неизвестный путь роняет тест, а не молчит. */
function route(table: [string, (c: Call) => unknown][]): Call[] {
	const seen: Call[] = []
	api.setTransport((url, init) => {
		const c: Call = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined }
		seen.push(c)
		for (const [key, fn] of table) {
			if (url.includes(key)) return Promise.resolve(fn(c))
		}
		return Promise.reject(new Error(`нет заглушки для ${url}`))
	})
	return seen
}

const envelope = <T>(data: T) => ({ data, arr_messages: [] })

afterEach(() => api.setTransport(null))

const jwt = (claims: unknown) => `x.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.y`
const now = () => Math.floor(Date.now() / 1000)

type FakeCtx = Ctx<Account> & { saved: (Account | null)[] }

function makeCtx(account: Account | null, over: Partial<Ctx<Account>> = {}): FakeCtx {
	const ctx = {
		account, saved: [] as (Account | null)[],
		json: true, flags: {}, page: 1, limit: 10,
		async saveAccount(a: Account | null) { ctx.saved.push(a); ctx.account = a },
		prompt: async () => "", secret: async () => "", warn: () => {},
		...over,
	} as FakeCtx
	return ctx
}

/** Вошедший аккаунт с живым токеном: обновляться незачем. */
const loggedIn = (): Account => ({
	...emptyAccount(),
	access: jwt({ exp: now() + 3600, data: { login: "u", clientId: "c1" } }),
	refresh: "r", expires: now() + 3600, clientId: "c1", category: "KR", segment: "51",
})

const guestReply = () => envelope({ accessToken: jwt({ exp: now() + 3600 }) })

describe("объявление провайдера", () => {
	test("умеет ровно то, что реализовано", () => {
		expect([...armtek.capabilities].sort()).toEqual(["analogs", "basket", "garage", "reviews"])
		expect(armtek.id).toBe("armtek")
	})
})

describe("search", () => {
	test("отдаёт товары, итог и страницу", async () => {
		const search = await fixture("search-list.json")
		const seen = route([["/guest", guestReply], ["/search", () => search]])
		const r = await armtek.search(makeCtx(null), "фильтр масляный")

		expect(r.items.length).toBe(search.data.articlesData.length)
		expect(r.total).toBe(557)
		expect(r.extra).toMatchObject({ perPage: 36 })
		// без входа поиск идёт гостевым токеном
		expect(seen[0]!.url).toContain("auth-microservice/v1/guest")
		expect(seen[1]!.body.query).toBe("фильтр масляный")
		expect(seen[1]!.body.queryType).toBe(1)
	})

	test("--limit режет выдачу", async () => {
		const search = await fixture("search-list.json")
		route([["/guest", guestReply], ["/search", () => search]])
		const r = await armtek.search(makeCtx(null, { limit: 1 }), "болт")
		expect(r.items).toHaveLength(1)
	})
})

describe("brands", () => {
	test("один бренд на строку, точные совпадения", async () => {
		const group = await fixture("search-brand-group.json")
		const seen = route([["/search", () => envelope({ typeView: "list", articlesData: group.data.articlesData, pagination: { currentPage: 1, perPage: 36, totalCount: 3, pageCount: 1 } })]])
		const pin = group.data.articlesData[0].PIN
		const r = await armtek.brands(makeCtx(loggedIn()), pin)
		expect(r.items.length).toBeGreaterThan(1)
		expect(seen[0]!.body.queryType).toBe(2)
	})

	// Один артикул выпускают и полсотни брендов, а страница — 36 строк:
	// обрезать список на первой странице значит соврать в ответе.
	test("список брендов добирается со всех страниц", async () => {
		const group = (await fixture("search-brand-group.json")).data.articlesData
		const seen = route([["/search", (c: Call) => envelope({
			typeView: "list",
			articlesData: c.body.page === 1 ? group : [{ ...group[0], BRAND: "ВТОРАЯ СТРАНИЦА", ARTID: 999 }],
			pagination: { currentPage: c.body.page, perPage: 36, totalCount: group.length + 1, pageCount: 2 },
		})]])
		const r = await armtek.brands(makeCtx(loggedIn()), group[0].PIN)
		expect(seen).toHaveLength(2)
		expect(seen.map(c => c.body.page)).toEqual([1, 2])
		expect(r.items.map(h => h.brand)).toContain("ВТОРАЯ СТРАНИЦА")
	})

	test("страниц берём не больше потолка", async () => {
		const group = (await fixture("search-brand-group.json")).data.articlesData
		const seen = route([["/search", (c: Call) => envelope({
			typeView: "list", articlesData: group,
			pagination: { currentPage: c.body.page, perPage: 36, totalCount: 10_000, pageCount: 300 },
		})]])
		await armtek.brands(makeCtx(loggedIn()), group[0].PIN)
		expect(seen).toHaveLength(MAX_PAGES)
	})
})

describe("offers", () => {
	const exactOnly = async () => {
		const rows = (await fixture("search-list.json")).data.articlesData
		return envelope({ typeView: "list", articlesData: rows.filter((a: any) => a.BRAND === "BOSCH"), pagination: { currentPage: 1, perPage: 36, totalCount: 1, pageCount: 1 } })
	}

	test("предложения выбранного бренда, без аналогов", async () => {
		const reply = await exactOnly()
		route([["/search", () => reply]])
		const r = await armtek.offers(makeCtx(loggedIn()), "0986452041", "bosch", { analogs: false })
		expect(r.items).toHaveLength(1)
		expect(r.items[0]!.brand).toBe("BOSCH")
		expect(r.items[0]!.analog).toBeUndefined()
		expect(r.items[0]!.ref).toMatchObject({ artid: 55469, keyzak: "MOV0000019" })
	})

	test("артикула нет — notfound", async () => {
		route([["/search", () => envelope({ typeView: "list", articlesData: [], pagination: { currentPage: 1, perPage: 36, totalCount: 0, pageCount: 0 } })]])
		const e = await armtek.offers(makeCtx(loggedIn()), "нетакого", "bosch", { analogs: false }).catch(x => x)
		expect(e).toBeInstanceOf(ProviderError)
		expect((e as ProviderError).code).toBe("notfound")
	})

	test("бренд не подошёл — ambiguous со списком брендов", async () => {
		const group = await fixture("search-brand-group.json")
		const pin = group.data.articlesData[0].PIN
		route([["/search", () => envelope({ typeView: "list", articlesData: group.data.articlesData, pagination: { currentPage: 1, perPage: 36, totalCount: 3, pageCount: 1 } })]])
		const e = await armtek.offers(makeCtx(loggedIn()), pin, "нет-такого-бренда", { analogs: false }).catch(x => x)
		expect((e as ProviderError).code).toBe("ambiguous")
		expect((e as ProviderError).items!.length).toBeGreaterThan(1)
	})

	test("--analogs добавляет чужие бренды и не теряет оригинал", async () => {
		const all = await fixture("search-list.json")
		const rows = all.data.articlesData
		let n = 0
		route([["/search", (c: Call) => {
			n++
			// первый запрос — точный (queryType 2), второй — с аналогами
			return c.body.queryType === 2
				? envelope({ typeView: "list", articlesData: rows.filter((a: any) => a.BRAND === "BOSCH"), pagination: { currentPage: 1, perPage: 36, totalCount: 1, pageCount: 1 } })
				: envelope({ typeView: "list", articlesData: rows.filter((a: any) => a.BRAND !== "BOSCH"), pagination: { currentPage: 1, perPage: 36, totalCount: 2, pageCount: 1 } })
		}]])
		const r = await armtek.offers(makeCtx(loggedIn()), "0986452041", "BOSCH", { analogs: true })
		expect(n).toBe(2)
		expect(r.items.some(o => !o.analog && o.brand === "BOSCH")).toBe(true)
		expect(r.items.some(o => o.analog)).toBe(true)
	})
})

describe("reviews", () => {
	test("лента и оценки по artId выбранного бренда", async () => {
		const rows = (await fixture("search-list.json")).data.articlesData
		const list = await fixture("reviews-list.json")
		const rat = await fixture("reviews-rating.json")
		const seen = route([
			["/search", () => envelope({ typeView: "list", articlesData: rows.filter((a: any) => a.BRAND === "BOSCH"), pagination: { currentPage: 1, perPage: 36, totalCount: 1, pageCount: 1 } })],
			["get-list-by-artid", () => list],
			["get-rating-by-artids", () => rat],
		])
		const r = await armtek.reviews!(makeCtx(loggedIn()), "0986452041", "BOSCH")
		expect(r.total).toBe(2)
		expect(r.rating!.histogram).toEqual([2, 0, 0, 0, 0])
		expect(seen.some(c => c.url.includes("artId=55469"))).toBe(true)
		expect(seen.some(c => c.url.includes("artids%5B%5D=55469") || c.url.includes("artids[]=55469"))).toBe(true)
	})

	test("оценки отвалились — лента всё равно отдаётся", async () => {
		const rows = (await fixture("search-list.json")).data.articlesData
		const list = await fixture("reviews-list.json")
		route([
			["/search", () => envelope({ typeView: "list", articlesData: rows.filter((a: any) => a.BRAND === "BOSCH"), pagination: { currentPage: 1, perPage: 36, totalCount: 1, pageCount: 1 } })],
			["get-list-by-artid", () => list],
			["get-rating-by-artids", () => { throw new Error("сервис лёг") }],
		])
		const r = await armtek.reviews!(makeCtx(loggedIn()), "0986452041", "BOSCH")
		expect(r.items).toHaveLength(2)
		expect(r.rating).toBeUndefined()
	})
})

describe("basket", () => {
	const cartRoute = async (state: () => unknown) => {
		const seen = route([["cart-microservice/v1/base", (c: Call) => (c.method === "GET" ? state() : envelope({ items: [{ posnr: 1, artid: 55469, keyzak: "MOV0000019", kwmeng: 1 }] }))]])
		return seen
	}

	test("список идёт с X-CA-VKORG и точкой выдачи аккаунта", async () => {
		const cart = await fixture("cart-list.json")
		const seen = await cartRoute(() => cart)
		const b = await armtek.basket!.list(makeCtx({ ...loggedIn(), vstel: "L31A", vkorg: "4000" }))
		expect(b.items[0]!.id).toBe("1")
		expect(b.total).toBe(592)
		expect(seen[0]!.url).toContain("vstels%5B%5D=L31A")
		expect(seen[0]!.url).toContain("clientCategory=KR")
	})

	test("кривой ref до сети не доходит", async () => {
		const seen = route([])
		const e = await armtek.basket!.add(makeCtx(loggedIn()), { чушь: 1 }, 1).catch(x => x)
		expect((e as ProviderError).code).toBe("bad_args")
		expect(seen).toHaveLength(0)
	})

	test("add шлёт POST с телом из ref и перечитывает корзину", async () => {
		const cart = await fixture("cart-list.json")
		const seen = await cartRoute(() => cart)
		const ref = { artid: 55469, keyzak: "MOV0000019", parnr: 0, numZak: "1", prices: 592, pricem: 624, waers: "RUB", charg: "", vstels: "ME86", zzsign: "S", minbm: 1, article: "0 986 452 041", brand: "BOSCH" }
		const b = await armtek.basket!.add(makeCtx(loggedIn()), ref, 2)

		const post = seen.find(c => c.method === "POST")!
		expect(post.body.vkorg).toBe("4000")
		expect(post.body.items).toEqual([{
			keyzak: "MOV0000019", parnr: 0, artid: 55469, kwmeng: 2, numZak: "1",
			prices: 592, pricem: 624, waers: "RUB", vstels: "ME86", charg: "",
			zzsign: "S", comments: "", podbor: "", status: "", saleCode: 0,
			parentPosnr: null, parentArtid: null, posnr: 0,
		}])
		expect(b.items).toHaveLength(1)
		// читаем до записи и после: корзина в ответе — это состояние сайта
		expect(seen.filter(c => c.method === "GET")).toHaveLength(2)
	})

	test("set меняет количество через PUT по существующему posnr", async () => {
		const cart = await fixture("cart-list.json")
		const seen = await cartRoute(() => cart)
		await armtek.basket!.set(makeCtx(loggedIn()), "1", 3)
		const put = seen.find(c => c.method === "PUT")!
		expect(put.body.items[0]).toMatchObject({ posnr: 1, kwmeng: 3, artid: 55469, prices: 592, pricem: 624 })
	})

	test("нет такой позиции — notfound без записи", async () => {
		const cart = await fixture("cart-list.json")
		const seen = await cartRoute(() => cart)
		const e = await armtek.basket!.set(makeCtx(loggedIn()), "99", 3).catch(x => x)
		expect((e as ProviderError).code).toBe("notfound")
		expect(seen.every(c => c.method === "GET")).toBe(true)
	})

	test("rm удаляет по posnr", async () => {
		const cart = await fixture("cart-list.json")
		const seen = await cartRoute(() => cart)
		await armtek.basket!.remove(makeCtx(loggedIn()), "1")
		const del = seen.find(c => c.method === "DELETE")!
		expect(del.body).toEqual({ vkorg: "4000", posnr: [1] })
	})

	test("без входа корзина отвечает auth, а не пустотой", async () => {
		const seen = route([])
		const e = await armtek.basket!.list(makeCtx(null)).catch(x => x)
		expect((e as ProviderError).code).toBe("auth")
		expect(seen).toHaveLength(0)
	})
})

describe("garage export", () => {
	test("машины приходят из гаража по clientId", async () => {
		const g = await fixture("garage-cars.json")
		const seen = route([["get-transport-list-by-filter", () => g]])
		const r = await armtek.garageExport!(makeCtx(loggedIn()))
		expect(r.cars).toHaveLength(1)
		expect(r.cars[0]!.brand).toBe("SKODA")
		expect(seen[0]!.url).toContain("client_id=c1")
	})

	test("без входа — auth", async () => {
		route([])
		const e = await armtek.garageExport!(makeCtx(null)).catch(x => x)
		expect((e as ProviderError).code).toBe("auth")
	})
})

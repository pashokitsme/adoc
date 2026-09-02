// Транспортный слой и жизненный цикл токенов. Сети здесь нет: транспорт
// подменяется швом setTransport, поэтому проверять можно и заголовки, и
// количество запросов.

import { afterEach, describe, expect, test } from "bun:test"
import * as api from "../../src/providers/armtek/api.ts"
import { accessToken, emptyAccount, guestToken, readToken, type Account } from "../../src/providers/armtek/auth.ts"
import { HttpError, ProviderError } from "../../src/sdk/index.ts"
import type { Ctx } from "../../src/sdk/define.ts"

type Sent = { url: string; init: RequestInit; headers: Record<string, string> }

/** Подменяет транспорт и записывает всё отправленное. */
function record(reply: (s: Sent, i: number) => unknown): Sent[] {
	const sent: Sent[] = []
	api.setTransport((url, init) => {
		const s: Sent = { url, init, headers: init.headers as Record<string, string> }
		sent.push(s)
		const r = reply(s, sent.length - 1)
		return r instanceof Promise ? r : Promise.resolve(r)
	})
	return sent
}

const envelope = <T>(data: T) => ({ data, arr_messages: [] })

afterEach(() => api.setTransport(null))

// --- контекст-заглушка ----------------------------------------------------

type FakeCtx = Ctx<Account> & { saved: (Account | null)[] }

function makeCtx(account: Account | null): FakeCtx {
	const ctx = {
		account,
		saved: [] as (Account | null)[],
		json: true,
		flags: {},
		page: 1,
		limit: 10,
		async saveAccount(a: Account | null) { ctx.saved.push(a); ctx.account = a },
		prompt: async () => "",
		secret: async () => "",
		warn: () => {},
	} as FakeCtx
	return ctx
}

// --- токены-заглушки ------------------------------------------------------

const jwt = (claims: unknown): string =>
	`x.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.y`

const now = () => Math.floor(Date.now() / 1000)
const liveToken = (name: string) => jwt({ exp: now() + 3600, data: { login: name } })
const deadToken = (name: string) => jwt({ exp: now() - 10, data: { login: name } })

const unauthorized = (path: string) =>
	new HttpError(401, path, JSON.stringify({ data: null, arr_messages: [{ type: "E", text: "Jwt токен не валиден" }] }))

// --- заголовки ------------------------------------------------------------

describe("заголовки исходящего запроса", () => {
	test("константы фронта и X-CA-VKORG есть всегда", () => {
		const h = api.requestHeaders()
		expect(h["X-AUTH-SYSTEM"]).toBe("AUTH_MICROSERVICE_V1_ARMTEK_RU")
		expect(h["X-AUTH-TOKEN"]).toBe("nJhNK87gJOOU6dfr")
		expect(h["X-CA-VKORG"]).toBe(api.DEFAULT_VKORG)
		expect(h.Accept).toBe("application/json")
	})

	test("Content-Type появляется только вместе с телом", () => {
		expect(api.requestHeaders()["Content-Type"]).toBeUndefined()
		expect(api.requestHeaders({ body: {} })["Content-Type"]).toBe("application/json")
	})

	test("vkorg аккаунта перебивает значение по умолчанию", () => {
		expect(api.requestHeaders({ vkorg: "8000" })["X-CA-VKORG"]).toBe("8000")
	})

	test("свои заголовки перебивают вычисленные", () => {
		expect(api.requestHeaders({ headers: { "X-CA-VKORG": "2000" } })["X-CA-VKORG"]).toBe("2000")
	})

	test("Authorization появляется только с токеном", () => {
		expect(api.requestHeaders()["Authorization"]).toBeUndefined()
		expect(api.requestHeaders({ token: "t" })["Authorization"]).toBe("Bearer t")
	})

	// Тихо пустая корзина без X-CA-VKORG — самая дорогая ловушка armtek:
	// сайт отвечает 200 и {items:[]}, отличить от честно пустой нельзя.
	test("листинг корзины уходит с X-CA-VKORG", async () => {
		const sent = record(() => envelope({ items: [], codes: [] }))
		await api.cartState("tok", { vstel: "ME86", vkorg: "4000" })
		expect(sent).toHaveLength(1)
		expect(sent[0]!.headers["X-CA-VKORG"]).toBe("4000")
		expect(sent[0]!.url).toContain("vstels%5B%5D=ME86")
	})

	test("все вызовы корзины несут заголовок, не только листинг", async () => {
		const sent = record(() => envelope(true))
		await api.cartDelete("tok", "8000", [1])
		expect(sent[0]!.headers["X-CA-VKORG"]).toBe("8000")
		expect(sent[0]!.init.method).toBe("DELETE")
		expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ vkorg: "8000", posnr: [1] })
	})

	test("поиск всегда задаёт typeView, иначе форму выбирает сервер", async () => {
		const sent = record(() => envelope({ typeView: "list", articlesData: [], pagination: {} }))
		await api.search({ query: "болт" }, "tok")
		const body = JSON.parse(String(sent[0]!.init.body))
		expect(body.typeView).toBe("list")
		expect(body.queryType).toBe(1)
		expect(body.userInfo).toEqual({ VKORG: "4000", VSTELS_LIST: ["ME86"] })
	})
})

// --- жизненный цикл токенов ------------------------------------------------

describe("гостевой токен", () => {
	test("берётся один раз и кладётся в аккаунт", async () => {
		const token = liveToken("GUEST_1")
		const sent = record(() => envelope({ accessToken: token }))
		const ctx = makeCtx(null)
		expect(await guestToken(ctx)).toBe(token)
		expect(sent).toHaveLength(1)
		expect(ctx.saved.at(-1)!.guest!.token).toBe(token)
	})

	test("живой кэш не ходит в сеть", async () => {
		const sent = record(() => { throw new Error("сети быть не должно") })
		const ctx = makeCtx({ ...emptyAccount(), guest: { token: "кэш", expires: now() + 600 } })
		expect(await guestToken(ctx)).toBe("кэш")
		expect(sent).toHaveLength(0)
	})

	test("протухший кэш заменяется новым", async () => {
		const fresh = liveToken("GUEST_2")
		const sent = record(() => envelope({ accessToken: fresh }))
		const ctx = makeCtx({ ...emptyAccount(), guest: { token: "старый", expires: now() - 1 } })
		expect(await guestToken(ctx)).toBe(fresh)
		expect(sent).toHaveLength(1)
	})

	test("срок жизни берётся из клейма exp, а не выдумывается", async () => {
		const exp = now() + 12345
		record(() => envelope({ accessToken: jwt({ exp }) }))
		const ctx = makeCtx(null)
		await guestToken(ctx)
		expect(ctx.saved.at(-1)!.guest!.expires).toBe(exp)
	})
})

describe("access-токен", () => {
	test("живой отдаётся как есть, обновления нет", async () => {
		const sent = record(() => { throw new Error("сети быть не должно") })
		const ctx = makeCtx({ ...emptyAccount(), access: "живой", refresh: "r", expires: now() + 600 })
		expect(await accessToken(ctx)).toBe("живой")
		expect(sent).toHaveLength(0)
		expect(ctx.saved).toHaveLength(0)
	})

	test("протухший обновляется, ротированная пара сохраняется", async () => {
		const access = liveToken("user")
		const sent = record(() => envelope({ accessToken: access, refreshToken: "refresh-2" }))
		const ctx = makeCtx({ ...emptyAccount(), access: "старый", refresh: "refresh-1", expires: now() - 1, vstel: "ME86" })

		expect(await accessToken(ctx)).toBe(access)
		expect(sent).toHaveLength(1)
		expect(sent[0]!.url).toContain("auth-microservice/v1/auth/refresh")
		// обновление авторизуется refresh-токеном, а не протухшим access
		expect(sent[0]!.headers["Authorization"]).toBe("Bearer refresh-1")

		const saved = ctx.saved.at(-1)!
		expect(saved.access).toBe(access)
		expect(saved.refresh).toBe("refresh-2")
		expect(saved.expires).toBe(Number(JSON.parse(Buffer.from(access.split(".")[1]!, "base64url").toString()).exp))
		expect(saved.vstel).toBe("ME86")
	})

	test("сервер не вернул новый refresh — держимся за старый", async () => {
		record(() => envelope({ accessToken: liveToken("user") }))
		const ctx = makeCtx({ ...emptyAccount(), access: "старый", refresh: "refresh-1", expires: now() - 1 })
		await accessToken(ctx)
		expect(ctx.saved.at(-1)!.refresh).toBe("refresh-1")
	})

	test("отозванный refresh: одна попытка, аккаунт чистится, ошибка auth", async () => {
		const sent = record(() => { throw unauthorized("auth-microservice/v1/auth/refresh") })
		const ctx = makeCtx({ ...emptyAccount(), access: "старый", refresh: "отозван", expires: now() - 1, clientId: "c1" })

		const e = await accessToken(ctx).catch(x => x)
		expect(e).toBeInstanceOf(ProviderError)
		expect((e as ProviderError).code).toBe("auth")
		expect(sent).toHaveLength(1)

		const saved = ctx.saved.at(-1)!
		expect(saved.access).toBeUndefined()
		expect(saved.refresh).toBeUndefined()
		expect(saved.expires).toBeUndefined()
		// всё, что не про вход, переживает разлогин
		expect(saved.clientId).toBe("c1")
	})

	test("не-401 при обновлении не стирает вход", async () => {
		record(() => { throw new HttpError(503, "refresh", "") })
		const ctx = makeCtx({ ...emptyAccount(), access: "старый", refresh: "r", expires: now() - 1 })
		const e = await accessToken(ctx).catch(x => x)
		expect((e as ProviderError).code).toBe("http")
		expect(ctx.saved).toHaveLength(0)
	})

	test("без входа — auth, а не попытка обновиться", async () => {
		const sent = record(() => envelope({}))
		const e = await accessToken(makeCtx(emptyAccount())).catch(x => x)
		expect((e as ProviderError).code).toBe("auth")
		expect(sent).toHaveLength(0)
	})
})

describe("readToken", () => {
	test("без входа берёт гостевой", async () => {
		const g = liveToken("GUEST_3")
		record(s => (s.url.includes("/guest") ? envelope({ accessToken: g }) : null))
		expect(await readToken(makeCtx(null))).toBe(g)
	})

	test("со входом берёт пользовательский и не трогает гостя", async () => {
		const sent = record(() => { throw new Error("сети быть не должно") })
		const ctx = makeCtx({ ...emptyAccount(), access: "мой", refresh: "r", expires: now() + 600 })
		expect(await readToken(ctx)).toBe("мой")
		expect(sent).toHaveLength(0)
	})

	test("протухший access не откатывается на гостя молча", async () => {
		record(() => { throw unauthorized("refresh") })
		const ctx = makeCtx({ ...emptyAccount(), access: deadToken("u"), refresh: "отозван", expires: now() - 1 })
		const e = await readToken(ctx).catch(x => x)
		expect((e as ProviderError).code).toBe("auth")
	})
})

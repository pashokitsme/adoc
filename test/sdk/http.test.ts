import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { HttpError, fetchJson } from "../../src/sdk/http.ts"
import { ProviderError } from "../../src/sdk/errors.ts"

let server: ReturnType<typeof Bun.serve>
let base: string
beforeAll(() => {
	server = Bun.serve({
		port: 0,
		async fetch(req) {
			const u = new URL(req.url)
			if (u.pathname === "/ok") return Response.json({ a: 1 })
			if (u.pathname === "/empty") return new Response("")
			if (u.pathname === "/html") return new Response("<html>", { headers: { "content-type": "text/html" } })
			if (u.pathname === "/401") return new Response("", { status: 401 })
			if (u.pathname === "/slow") { await Bun.sleep(300); return Response.json({}) }
			if (u.pathname === "/stall") {
				// Отдаём заголовки и кусок тела, но поток не закрываем никогда.
				const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")) } })
				return new Response(body, { headers: { "content-type": "application/json" } })
			}
			return new Response("nope", { status: 404 })
		},
	})
	base = `http://localhost:${server.port}`
})
afterAll(() => server.stop(true))

describe("fetchJson", () => {
	test("json", async () => { expect(await fetchJson<{ a: number }>(`${base}/ok`)).toEqual({ a: 1 }) })
	test("пустое тело — null", async () => { expect(await fetchJson(`${base}/empty`)).toBeNull() })
	test("не JSON — HttpError со статусом 200", async () => {
		const e = await fetchJson(`${base}/html`).catch(x => x)
		expect(e).toBeInstanceOf(HttpError)
		expect((e as HttpError).status).toBe(200)
	})
	test("401 — HttpError с status", async () => {
		const e = await fetchJson(`${base}/401`).catch(x => x)
		expect(e).toBeInstanceOf(HttpError)
		expect((e as HttpError).status).toBe(401)
	})
	test("таймаут — ProviderError timeout", async () => {
		const e = await fetchJson(`${base}/slow`, undefined, { timeoutMs: 50 }).catch(x => x)
		expect(e).toBeInstanceOf(ProviderError)
		expect((e as ProviderError).code).toBe("timeout")
	})
	test("тело зависло — тоже ProviderError timeout", async () => {
		const e = await fetchJson(`${base}/stall`, undefined, { timeoutMs: 50 }).catch(x => x)
		expect(e).toBeInstanceOf(ProviderError)
		expect((e as ProviderError).code).toBe("timeout")
	})
	test("сигнал вызывающего не теряется", async () => {
		const caller = new AbortController()
		caller.abort()
		const e = await fetchJson(`${base}/slow`, { signal: caller.signal }).catch(x => x)
		expect(e).toBeInstanceOf(Error)
	})
})

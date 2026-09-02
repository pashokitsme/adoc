import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../../src/sdk/config.ts"
import { accountStore } from "../../../src/sdk/account.ts"

const BIN = join(import.meta.dir, "../../../src/providers/autodoc/main.ts")
const FIX = join(import.meta.dir, "../../fixtures/autodoc/http")
let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-autodoc-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

const live = () => accountStore("autodoc").save({ access_token: "a.b.c", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600 })

async function run(args: string[]) {
	const proc = Bun.spawn(["bun", BIN, ...args, "--json"], {
		env: { ...process.env, [CONFIG_DIR_ENV]: dir, ADOC_FIXTURES: FIX, NO_COLOR: "1", ADOC_LINKS: "list" },
		stdin: "ignore", stdout: "pipe", stderr: "pipe",
	})
	const out = await new Response(proc.stdout).text()
	return { code: await proc.exited, json: JSON.parse(out) }
}

describe("adoc-autodoc", () => {
	test("describe", async () => {
		const r = await run(["describe"])
		expect(r.json.id).toBe("autodoc")
		expect(r.json.capabilities).toEqual(["reviews", "garage", "analogs", "basket", "orders", "fits"])
	})
	test("brands", async () => {
		const r = await run(["brands", "n90954802"])
		expect(r.json.items[0]).toMatchObject({ brand: "VAG", rating: { count: 56 } })
	})
	test("offers без входа — auth", async () => {
		expect((await run(["offers", "n90954802", "--brand", "VAG"])).json.error.code).toBe("auth")
	})
	test("offers с входом", async () => {
		await live()
		const r = await run(["offers", "n90954802", "--brand", "VAG"])
		expect(r.code).toBe(0)
		expect(r.json.items.filter((o: { analog?: boolean }) => !o.analog)).toHaveLength(2)
	})
	test("offers --analogs добавляет аналоги", async () => {
		await live()
		const r = await run(["offers", "n90954802", "--brand", "VAG", "--analogs"])
		expect(r.code).toBe(0)
		const items = r.json.items as { article: string; analog?: boolean }[]
		expect(items.filter(o => !o.analog)).toHaveLength(2)
		expect(items.filter(o => o.analog).map(o => o.article)).toContain("WHT 005 437")
	})
	// Команда `analogs` жила на price-service/price-list/analogs, а он отдаёт
	// кросс-таблицу замен без строк прайса — выдача выходила пустой, хотя
	// `offers --analogs` аналоги находил. Держим их на одном источнике.
	test("analogs — ровно analog:true из offers --analogs, и не пусто", async () => {
		await live()
		const [an, off] = await Promise.all([
			run(["analogs", "n90954802", "--brand", "VAG"]),
			run(["offers", "n90954802", "--brand", "VAG", "--analogs"]),
		])
		expect(an.code).toBe(0)
		const items = an.json.items as { article: string; analog?: boolean }[]
		expect(items.length).toBeGreaterThan(0)
		expect(items.every(o => o.analog)).toBe(true)
		expect(an.json.total).toBe(items.length)

		const fromOffers = (off.json.items as { article: string; analog?: boolean }[]).filter(o => o.analog)
		expect(items.map(o => o.article).sort()).toEqual(fromOffers.map(o => o.article).sort())
		// аналог из групп originals тоже должен быть здесь, а не только из ручки аналогов
		expect(items.map(o => o.article)).toContain("2098-001-PCS2")
	})
	test("offers с неверным брендом — ambiguous", async () => {
		await live()
		expect((await run(["offers", "n90954802", "--brand", "BOSCH"])).code).toBe(2)
	})
	test("search по названию: категория → товары", async () => {
		const r = await run(["search", "болт"])
		expect(r.json.items[0].article).toBe("kr013511020")
		expect(r.json.extra.categories).toHaveLength(2)
	})
	test("reviews", async () => {
		const r = await run(["reviews", "n90954802", "--brand", "VAG"])
		expect(r.json.total).toBe(35)
		expect(r.json.rating.histogram).toEqual([54, 1, 0, 0, 1])
	})
	test("garage export", async () => {
		await live()
		const r = await run(["garage", "export"])
		expect(r.json.cars[0].ref).toEqual({ carId: 10, modificationId: 58759, modelId: 11195, brandName: "SKODA", main: true })
	})
	test("basket", async () => {
		await live()
		const r = await run(["basket"])
		expect(r.json.items[0]).toMatchObject({ id: "555", quantity: 2 })
	})
	test("whoami с токеном показывает поля как их отдаёт сайт", async () => {
		const payload = Buffer.from(JSON.stringify({ unique_name: "user1", email: "pavel@example.com", displayEmail: "pa***@example.com", phone_number: "+79990001234" })).toString("base64url")
		await accountStore("autodoc").save({ access_token: `h.${payload}.s`, expires_at: Math.floor(Date.now() / 1000) + 3600 })
		const r = await run(["whoami"])
		expect(r.json).toEqual({ ok: true, display: { name: "user1", email: "pavel@example.com", phone: "+79990001234" } })
	})
	test("whoami с протухшим токеном — ok:false, файл аккаунта не трогаем", async () => {
		const expired = { access_token: "a.b.c", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) - 3600 }
		await accountStore("autodoc").save(expired)
		const r = await run(["whoami"])
		expect(r.code).toBe(0)
		expect(r.json).toEqual({ ok: false })
		expect(await accountStore("autodoc").load()).toEqual(expired)
	})
})

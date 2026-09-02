import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV, accountStore } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import type { Order } from "../../src/sdk/index.ts"
import { plainOutput } from "../plain.ts"

type OrdersJson = { providers: Record<string, Order[]>; errors: { provider: string; code: string }[] }
/** Позиция заказа с ценой «сейчас»: её проставляет обёртка, а не сайт. */
type ItemNow = { price: number; now?: number; nowSeller?: string; nowRef?: Record<string, unknown> }

let dir: string
let restore: () => void
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-orders-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	restore = plainOutput()
	await accountStore("alpha").save({ token: "t", user: "pavel" })
	await accountStore("beta").save({ token: "t", user: "pavel" })
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_BETA_NOORDERS
	delete process.env.FAKE_ALPHA_FAIL_ORDERS
	delete process.env.FAKE_BETA_FAIL_ORDERS
	delete process.env.FAKE_ALPHA_FAIL_OFFERS
	delete process.env.FAKE_ALPHA_KIT_OFFER
	delete process.env.FAKE_ALPHA_SECOND_SELLER
	delete process.env.FAKE_ALPHA_ALIEN_OFFERS
	restore()
	await rm(dir, { recursive: true, force: true })
})

const orders = async (): Promise<OrdersJson> => JSON.parse((await run(["orders", "--json"])).stdout) as OrdersJson

/** Первая позиция первого заказа alpha с ценами: её и сверяем в тестах --prices. */
const firstItem = async (): Promise<ItemNow> => {
	const j = JSON.parse((await run(["orders", "--prices", "--json"])).stdout) as OrdersJson
	return j.providers.alpha![0]!.items![0]! as ItemNow
}

describe("adoc orders", () => {
	test("заказы обоих сайтов, ключ — id провайдера", async () => {
		const j = await orders()
		expect(Object.keys(j.providers)).toEqual(["alpha", "beta"])
		expect(j.providers.alpha![0]).toMatchObject({ id: "alpha-1", status: "выдан", currency: "RUB" })
		expect(j.providers.alpha![0]!.items![0]).toMatchObject({ article: "N90954802", qty: 2 })
	})

	test("блок на сайт: номер, дата, статус и ссылка на заказ", async () => {
		const r = await run(["orders"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("№ alpha-1")
		expect(r.stdout).toContain("2026-01-02")
		expect(r.stdout).toContain("выдан")
		expect(r.stdout).toContain("https://alpha.example/orders/1")
	})

	test("--prices: сегодняшняя цена и разница с уплаченной", async () => {
		const r = await run(["orders", "--prices"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("СЕЙЧАС")
		expect(r.stdout).toContain("Δ")
		const it = await firstItem()
		expect(it.now).toBe(407)
		expect(it.price).toBe(407)
	})

	test("--prices: колонка ОТКУДА называет продавца выбранного предложения", async () => {
		const r = await run(["orders", "--prices"])
		expect(r.stdout).toContain("ОТКУДА")
		expect(r.stdout).toContain("склад А")
		const it = await firstItem()
		expect(it.nowSeller).toBe("склад А")
		expect(it.nowRef).toEqual({ line: "alpha-1" })
	})

	test("--prices: цена берётся у самого дешёвого продавца, он же в ОТКУДА", async () => {
		process.env.FAKE_ALPHA_SECOND_SELLER = "1"
		const r = await run(["orders", "--prices"])
		expect(r.stdout).toContain("второй продавец")
		const it = await firstItem()
		expect(it.now).toBe(400)
		expect(it.nowSeller).toBe("второй продавец")
		expect(it.nowRef).toEqual({ line: "alpha-2" })
	})

	test("--prices: комплект под тем же номером — «?» вместо Δ", async () => {
		process.env.FAKE_ALPHA_KIT_OFFER = "1"
		const r = await run(["orders", "--prices"])
		expect(r.stdout).toContain("?")
		// Разница с уплаченным не печатается вовсе: сравнивать комплект со штукой
		// нечестно, и −100 ₽ на экране было бы неправдой.
		expect(r.stdout).not.toContain("−100 ₽")
		const it = await firstItem()
		expect(it.now).toBe(307)
		expect(it.nowSeller).toBe("склад комплектов")
	})

	test("--prices: чужой артикул и бренд в выдаче не берём", async () => {
		process.env.FAKE_ALPHA_ALIEN_OFFERS = "1"
		const r = await run(["orders", "--prices"])
		expect(r.stdout).not.toContain("чужой склад")
		const it = await firstItem()
		expect(it.now).toBe(407)
		expect(it.nowSeller).toBe("склад А")
	})

	test("без --prices колонок «сейчас» нет вовсе", async () => {
		const r = await run(["orders"])
		expect(r.stdout).not.toContain("СЕЙЧАС")
	})

	test("сайт ограничил темп — цены дальше не спрашиваем, заказы остаются", async () => {
		process.env.FAKE_ALPHA_FAIL_OFFERS = "http"
		const r = await run(["orders", "--prices"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("№ alpha-1")
		expect(r.stderr).toContain("цены «сейчас» дальше не спрашиваем")
		delete process.env.FAKE_ALPHA_FAIL_OFFERS
	})

	test("сайт без заказов не спрашивается, но назван в stderr", async () => {
		process.env.FAKE_BETA_NOORDERS = "1"
		const r = await run(["orders"])
		expect(r.stderr).toContain("без заказов, не спрашиваем: beta")
		expect(Object.keys((JSON.parse((await run(["orders", "--json"])).stdout) as OrdersJson).providers)).toEqual(["alpha"])
	})

	test("без входа — жёлтая строка про login и код 1", async () => {
		await rm(join(dir, "accounts"), { recursive: true, force: true })
		const r = await run(["orders"])
		expect(r.code).toBe(1)
		expect(r.stderr).toContain("нужен вход — adoc login alpha")
		expect(r.stdout).toContain("ни один сайт не ответил")
	})

	test("один сайт упал — второй показывается, код 0", async () => {
		process.env.FAKE_ALPHA_FAIL_ORDERS = "http"
		const j = await orders()
		expect(Object.keys(j.providers)).toEqual(["beta"])
		expect(j.errors).toHaveLength(1)
	})
})

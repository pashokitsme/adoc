import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV, accountStore } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import type { Order } from "../../src/core/delta.ts"

type OrdersJson = { providers: Record<string, Order[]>; errors: { provider: string; code: string }[] }

let dir: string
let color: string | undefined
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-orders-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	// Таблица сверяется как текст: цвета из TTY ломали бы toContain.
	color = process.env.NO_COLOR
	process.env.NO_COLOR = "1"
	await accountStore("alpha").save({ token: "t", user: "pavel" })
	await accountStore("beta").save({ token: "t", user: "pavel" })
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_BETA_NOORDERS
	delete process.env.FAKE_ALPHA_FAIL_ORDERS
	delete process.env.FAKE_BETA_FAIL_ORDERS
	if (color === undefined) delete process.env.NO_COLOR
	else process.env.NO_COLOR = color
	await rm(dir, { recursive: true, force: true })
})

const orders = async (): Promise<OrdersJson> => JSON.parse((await run(["orders", "--json"])).stdout) as OrdersJson

describe("adoc orders", () => {
	test("заказы обоих сайтов, ключ — id провайдера", async () => {
		const j = await orders()
		expect(Object.keys(j.providers)).toEqual(["alpha", "beta"])
		expect(j.providers.alpha![0]).toMatchObject({ id: "alpha-100", status: "доставлен", currency: "RUB" })
		expect(j.providers.alpha![0]!.items![0]).toMatchObject({ article: "N90954802", qty: 1 })
	})

	test("таблица по сайтам с номером, датой и ссылкой на заказ", async () => {
		const r = await run(["orders"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("НОМЕР")
		expect(r.stdout).toContain("2026-01-02")
		expect(r.stdout).toContain("https://alpha.example/orders/100")
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

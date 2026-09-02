import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV, accountStore } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { LAST_PART_FILE } from "../../src/core/lastpart.ts"
import { writeJson } from "../../src/core/store.ts"
import type { Basket } from "../../src/sdk/index.ts"

type ListJson = { providers: Record<string, Basket>; total: number; errors: { provider: string; code: string }[] }
type OneJson = { provider: string; basket: Basket }

let dir: string
let color: string | undefined
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-basket-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	// Таблицы сверяются как текст: цвета из TTY ломали бы toContain.
	color = process.env.NO_COLOR
	process.env.NO_COLOR = "1"
	await accountStore("alpha").save({ token: "t", user: "pavel" })
	await accountStore("beta").save({ token: "t", user: "pavel" })
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_NOBASKET
	if (color === undefined) delete process.env.NO_COLOR
	else process.env.NO_COLOR = color
	await rm(dir, { recursive: true, force: true })
})

const list = async (): Promise<ListJson> => JSON.parse((await run(["basket", "--json"])).stdout) as ListJson

describe("adoc basket", () => {
	test("пустые корзины обоих сайтов и общий итог", async () => {
		const j = await list()
		expect(Object.keys(j.providers)).toEqual(["alpha", "beta"])
		expect(j.total).toBe(0)
		expect(j.errors).toEqual([])
	})

	test("basket add <n> берёт строку из последней выдачи part", async () => {
		await run(["part", "n90954802"])
		const r = await run(["basket", "add", "1", "--qty", "2", "--json"])
		expect(r.code).toBe(0)
		const j = JSON.parse(r.stdout) as OneJson
		// Первая строка выдачи — beta, она дешевле.
		expect(j.provider).toBe("beta")
		expect(j.basket.items[0]).toMatchObject({ id: "beta-1", quantity: 2 })
		const all = await list()
		expect(all.total).toBe(760)
		expect(all.providers.alpha!.items).toEqual([])
	})

	test("basket add <provider> --ref кладёт без всякого кэша", async () => {
		const r = await run(["basket", "add", "alpha", "--ref", JSON.stringify({ line: "alpha-1" }), "--json"])
		const j = JSON.parse(r.stdout) as OneJson
		expect(j.provider).toBe("alpha")
		expect(j.basket.items[0]).toMatchObject({ id: "alpha-1", quantity: 1 })
	})

	test("после изменения печатается корзина того сайта, которого тронули", async () => {
		await run(["basket", "add", "alpha", "--ref", JSON.stringify({ line: "alpha-1" })])
		const r = await run(["basket", "set", "alpha", "alpha-1", "--qty", "4"])
		expect(r.stdout).toContain("alpha")
		expect(r.stdout).toContain("итого")
		const j = JSON.parse((await run(["basket", "set", "alpha", "alpha-1", "--qty", "5", "--json"])).stdout) as OneJson
		expect(j.basket.items[0]!.quantity).toBe(5)
	})

	test("basket rm убирает позицию", async () => {
		await run(["basket", "add", "alpha", "--ref", JSON.stringify({ line: "alpha-1" })])
		const j = JSON.parse((await run(["basket", "rm", "alpha", "alpha-1", "--json"])).stdout) as OneJson
		expect(j.basket.items).toEqual([])
	})

	test("itemId можно назвать и флагом --id", async () => {
		await run(["basket", "add", "alpha", "--ref", JSON.stringify({ line: "alpha-1" })])
		const set = JSON.parse((await run(["basket", "set", "alpha", "--id", "alpha-1", "--qty", "3", "--json"])).stdout) as OneJson
		expect(set.basket.items[0]!.quantity).toBe(3)
		const rm = JSON.parse((await run(["basket", "rm", "alpha", "--id", "alpha-1", "--json"])).stdout) as OneJson
		expect(rm.basket.items).toEqual([])
	})

	test("итог по всем сайтам складывается", async () => {
		await run(["basket", "add", "alpha", "--ref", JSON.stringify({ line: "alpha-1" })])
		await run(["basket", "add", "beta", "--ref", JSON.stringify({ line: "beta-1" })])
		const j = await list()
		expect(j.total).toBe(787)
	})

	test("таблица показывает срок, количество и итог по каждому сайту", async () => {
		await run(["basket", "add", "alpha", "--ref", JSON.stringify({ line: "alpha-1" }), "--qty", "2"])
		const r = await run(["basket"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("СРОК")
		expect(r.stdout).toContain("2 дня")
		expect(r.stdout).toContain("всего по всем сайтам")
		expect(r.stdout).toContain("814")
	})

	test("сайт без входа — жёлтая строка, остальные печатаются", async () => {
		await accountStore("alpha").clear()
		const r = await run(["basket", "--json"])
		expect(r.code).toBe(0)
		expect(r.stderr).toContain("adoc login alpha")
		const j = JSON.parse(r.stdout) as ListJson
		expect(Object.keys(j.providers)).toEqual(["beta"])
		expect(j.errors[0]).toMatchObject({ provider: "alpha", code: "auth" })
	})

	test("отказ записи подписан один раз и зовёт login", async () => {
		await accountStore("alpha").clear()
		const r = await run(["basket", "add", "alpha", "--ref", JSON.stringify({ line: "alpha-1" })])
		expect(r.code).toBe(1)
		// Правило подписи одно на всю обёртку: имя провайдера ровно один раз и
		// подсказка про вход — та же строка, что у отказов в списке.
		expect(r.stderr.split("alpha: нужен вход — adoc login alpha")).toHaveLength(2)
		expect(r.stderr).not.toContain("alpha: alpha:")
	})

	test("сайт без корзины: адресная команда — bad_args, список его пропускает", async () => {
		process.env.FAKE_ALPHA_NOBASKET = "1"
		const e = JSON.parse((await run(["basket", "add", "alpha", "--ref", "{}", "--json"])).stdout) as { error: { code: string; message: string } }
		expect(e.error.code).toBe("bad_args")
		expect(e.error.message).toContain("basket")
		const r = await run(["basket", "--json"])
		expect(r.code).toBe(0)
		expect(r.stderr).toContain("без корзины, не спрашиваем: alpha")
		expect(Object.keys((JSON.parse(r.stdout) as ListJson).providers)).toEqual(["beta"])
	})

	test("не вошёл никуда — exit 1", async () => {
		await accountStore("alpha").clear()
		await accountStore("beta").clear()
		const r = await run(["basket", "--json"])
		expect(r.code).toBe(1)
		expect((JSON.parse(r.stdout) as ListJson).errors).toHaveLength(2)
	})

	test("протухший кэш выдачи — просим повторить part", async () => {
		await writeJson(LAST_PART_FILE, {
			article: "N1", brand: "VAG", at: new Date(Date.now() - 48 * 3600_000).toISOString(),
			lines: [{ provider: "alpha", article: "N1", brand: "VAG", price: 1, ref: { line: "alpha-1" } }],
		})
		const r = await run(["basket", "add", "1", "--json"])
		expect(r.code).toBe(1)
		expect(JSON.parse(r.stdout).error.message).toContain("старше суток")
	})

	test("кэша выдачи нет вовсе — зовём сначала part", async () => {
		const r = await run(["basket", "add", "1", "--json"])
		expect(r.code).toBe(1)
		const e = JSON.parse(r.stdout) as { error: { code: string; message: string } }
		expect(e.error.code).toBe("bad_args")
		expect(e.error.message).toContain("adoc part")
	})

	test("номера строки нет в выдаче", async () => {
		await run(["part", "n90954802"])
		expect(JSON.parse((await run(["basket", "add", "99", "--json"])).stdout).error.code).toBe("bad_args")
	})

	test("set без --qty и rm без itemId — bad_args", async () => {
		expect(JSON.parse((await run(["basket", "set", "alpha", "alpha-1", "--json"])).stdout).error.code).toBe("bad_args")
		expect(JSON.parse((await run(["basket", "rm", "alpha", "--json"])).stdout).error.code).toBe("bad_args")
	})

	test("неизвестный провайдер в адресной команде", async () => {
		const e = JSON.parse((await run(["basket", "add", "гамма", "--ref", "{}", "--json"])).stdout) as { error: { code: string; message: string } }
		expect(e.error.code).toBe("bad_args")
		expect(e.error.message).toContain("гамма")
	})

	test("неизвестная подкоманда", async () => {
		expect(JSON.parse((await run(["basket", "нетакой", "--json"])).stdout).error.message).toContain("нетакой")
	})

	test("адрес корзины под итогом, адрес позиции — колонкой", async () => {
		await run(["part", "n90954802"])
		await run(["basket", "add", "1"])
		const r = await run(["basket"])
		expect(r.stdout).toContain("https://beta.example/basket")
		expect(r.stdout).toContain("https://beta.example/p/N%20909%20548%2002")
	})
})

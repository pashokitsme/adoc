import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV, accountStore } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { plainOutput } from "../plain.ts"

type AnalogsJson = {
	article: string
	brand: string | null
	analogs: { provider: string; article: string; brand: string; price: number; url?: string; analog?: boolean }[]
	errors: { provider: string; code: string }[]
}

let dir: string
let restore: () => void
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-analogs-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	restore = plainOutput()
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_FAIL_ANALOGS
	delete process.env.FAKE_BETA_FAIL_ANALOGS
	restore()
	await rm(dir, { recursive: true, force: true })
})

const analogs = async (args: string[]): Promise<AnalogsJson> =>
	JSON.parse((await run(["analogs", ...args, "--json"])).stdout) as AnalogsJson

describe("adoc analogs", () => {
	test("заменители всех сайтов одной таблицей, дешёвый первым", async () => {
		const j = await analogs(["n90954802"])
		expect(j.brand).toBe("VAG")
		expect(j.analogs.map(a => a.provider)).toEqual(["beta", "alpha"])
		expect(j.analogs.every(a => a.analog === true)).toBe(true)
	})

	test("в таблице колонка ПРОВАЙДЕР, а адрес — колонкой ССЫЛКА", async () => {
		const r = await run(["analogs", "n90954802"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("ПРОВАЙДЕР")
		expect(r.stdout).toContain("аналоги")
		expect(r.stdout).toContain("ССЫЛКА")
		expect(r.stdout.split("\n").find(l => l.startsWith("1  beta"))).toContain("https://beta.example/p/AN-1")
	})

	test("артикулы через запятую — раздел на каждый", async () => {
		const r = await run(["analogs", "n90954802,нетакого", "--json"])
		const j = JSON.parse(r.stdout) as { items: { article: string }[] }
		expect(r.code).toBe(0)
		expect(j.items.map(i => i.article)).toEqual(["n90954802", "нетакого"])
	})

	test("под коротким списком сказано, что это замены по номеру", async () => {
		const r = await run(["analogs", "n90954802"])
		expect(r.stdout).toContain("это замены по номеру")
		expect(r.stdout).toContain("adoc search")
	})

	test("--limit режет таблицу и говорит, сколько всего", async () => {
		const r = await run(["analogs", "n90954802", "--limit", "1"])
		expect(r.stdout).toContain("показано 1 из 2")
	})

	test("номера строк годятся для basket add", async () => {
		await accountStore("beta").save({ token: "t", user: "pavel" })
		await run(["analogs", "n90954802"])
		const r = await run(["basket", "add", "1", "--json"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("beta-9")
	})

	test("один сайт упал — второй показывается, код 0", async () => {
		process.env.FAKE_ALPHA_FAIL_ANALOGS = "http"
		const j = await analogs(["n90954802"])
		expect(j.analogs.map(a => a.provider)).toEqual(["beta"])
		expect(j.errors).toHaveLength(1)
	})

	test("упали все — код 1", async () => {
		process.env.FAKE_ALPHA_FAIL_ANALOGS = "http"
		process.env.FAKE_BETA_FAIL_ANALOGS = "http"
		expect((await run(["analogs", "n90954802", "--json"])).code).toBe(1)
	})

	test("заменителей нет — говорим про них, а не про предложения", async () => {
		process.env.FAKE_BETA_EMPTY_ANALOGS = "1"
		const r = await run(["analogs", "n90954802", "--skip", "alpha"])
		expect(r.stdout).toContain("заменителей нет")
		delete process.env.FAKE_BETA_EMPTY_ANALOGS
	})

	test("брендов несколько — «нужен бренд» с кодом 2", async () => {
		const r = await run(["analogs", "MULTI-1"])
		expect(r.code).toBe(2)
		expect(r.stderr).toContain("adoc analogs <артикул> <бренд>")
	})
})

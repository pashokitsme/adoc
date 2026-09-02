import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { plainOutput } from "../plain.ts"

type CrossesJson = {
	article: string
	brand: string | null
	crosses: { article: string; brand: string; kind: string; providers: string[]; urls: Record<string, string> }[]
	total: number
	errors: { provider: string }[]
}

let dir: string
let restore: () => void
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-crosses-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	restore = plainOutput()
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_FAIL_CROSSES
	delete process.env.FAKE_ALPHA_EMPTY_CROSSES
	restore()
	await rm(dir, { recursive: true, force: true })
})

const crosses = async (args: string[]): Promise<{ code: number; j: CrossesJson; stdout: string }> => {
	const r = await run(["crosses", ...args, "--json"])
	return { code: r.code, j: JSON.parse(r.stdout) as CrossesJson, stdout: r.stdout }
}

describe("adoc crosses", () => {
	test("один номер у двух сайтов — одна строка с колонкой «где»", async () => {
		const { code, j } = await crosses(["n90954802"])
		expect(code).toBe(0)
		const shared = j.crosses.find(c => c.article === "CROSS-1")!
		expect(shared.providers).toEqual(["alpha", "beta"])
		expect(Object.keys(shared.urls)).toEqual(["alpha", "beta"])
		// у каждого сайта есть и свой номер, который знает только он
		expect(j.crosses.filter(c => c.providers.length === 1)).toHaveLength(2)
	})

	test("вид ссылки доезжает до выдачи словом", async () => {
		const r = await run(["crosses", "n90954802"])
		expect(r.stdout).toContain("ЧТО ЭТО")
		expect(r.stdout).toContain("замена")
		expect(r.stdout).toContain("в составе узла")
		expect(r.stdout).toContain("ГДЕ")
	})

	test("знание вытесняет незнание: part-of сильнее общего aftermarket", async () => {
		const { j } = await crosses(["n90954802"])
		expect(j.crosses.find(c => c.article === "ALPHA-KIT")!.kind).toBe("part-of")
	})

	test("--limit режет и говорит, сколько всего", async () => {
		const r = await run(["crosses", "n90954802", "--limit", "1"])
		expect(r.stdout).toContain("показано 1 из 3")
	})

	test("отказ одного сайта не отменяет второго", async () => {
		process.env.FAKE_ALPHA_FAIL_CROSSES = "http"
		const { code, j } = await crosses(["n90954802"])
		expect(code).toBe(0)
		expect(j.errors).toHaveLength(1)
		expect(j.crosses.every(c => c.providers.includes("beta"))).toBe(true)
	})

	test("пусто у всех — не ошибка", async () => {
		process.env.FAKE_ALPHA_EMPTY_CROSSES = "1"
		process.env.FAKE_BETA_EMPTY_CROSSES = "1"
		const r = await run(["crosses", "n90954802"])
		delete process.env.FAKE_BETA_EMPTY_CROSSES
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("кросс-ссылок нет")
	})
})

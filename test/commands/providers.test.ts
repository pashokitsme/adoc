import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV, accountStore } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "providers")

let dir: string
let color: string | undefined
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-cmd-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = FIXTURES
	// Таблицы сверяются как текст: escape-последовательности внутри ячейки
	// ломали бы toContain, если тест запущен из терминала.
	color = process.env.NO_COLOR
	process.env.NO_COLOR = "1"
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	if (color === undefined) delete process.env.NO_COLOR
	else process.env.NO_COLOR = color
	await rm(dir, { recursive: true, force: true })
})

describe("adoc providers", () => {
	test("таблица со всеми найденными", async () => {
		const r = await run(["providers"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("alpha")
		expect(r.stdout).toContain("beta")
		expect(r.stdout).toContain("basket")
	})

	test("--json отдаёт id, capabilities и чем запускается", async () => {
		const r = await run(["providers", "--json"])
		const j = JSON.parse(r.stdout) as { providers: { id: string; capabilities: string[]; account: boolean; bin: string }[] }
		expect(j.providers.map(p => p.id)).toEqual(["alpha", "beta"])
		expect(j.providers[0]!.capabilities).toContain("reviews")
		expect(j.providers[0]!.account).toBe(false)
		expect(j.providers[0]!.bin).toContain("alpha")
	})

	test("аккаунт виден по файлу, без единого вызова сайта", async () => {
		await accountStore("alpha").save({ token: "t", user: "pavel" })
		const j = JSON.parse((await run(["providers", "--json"])).stdout) as { providers: { id: string; account: boolean }[] }
		expect(j.providers.find(p => p.id === "alpha")!.account).toBe(true)
	})

	test("битый провайдер попадает в broken, а не в providers", async () => {
		process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "odd")
		const j = JSON.parse((await run(["providers", "--json"])).stdout) as { providers: { id: string }[]; broken: { id: string; message: string }[] }
		expect(j.providers.map(p => p.id)).toEqual(["noisy"])
		expect(j.broken[0]!.id).toBe("broken")
	})

	test("длинный путь в таблице ужат с головы, а в --json остаётся целым", async () => {
		const r = await run(["providers"])
		// Фикстуры лежат глубоко, поэтому в таблице виден только хвост пути.
		expect(r.stdout).toContain("…/providers/alpha/main.ts")
		const j = JSON.parse((await run(["providers", "--json"])).stdout) as { providers: { bin: string }[] }
		expect(j.providers[0]!.bin).not.toContain("…")
		expect(j.providers[0]!.bin.startsWith("bun /")).toBe(true)
	})
})

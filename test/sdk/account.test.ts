import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV, configDir } from "../../src/sdk/config.ts"
import { accountStore } from "../../src/sdk/account.ts"

let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-test-"))
	process.env[CONFIG_DIR_ENV] = dir
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	await rm(dir, { recursive: true, force: true })
})

describe("configDir", () => {
	test("переменная окружения имеет приоритет", () => {
		expect(configDir()).toBe(dir)
	})
	test("без переменной — XDG_CONFIG_HOME/adoc", () => {
		delete process.env[CONFIG_DIR_ENV]
		process.env.XDG_CONFIG_HOME = "/x"
		expect(configDir()).toBe("/x/adoc")
		delete process.env.XDG_CONFIG_HOME
	})
})

describe("accountStore", () => {
	test("пустой стор отдаёт null", async () => {
		expect(await accountStore<{ t: string }>("demo").load()).toBeNull()
	})
	test("save/load/clear и права 600", async () => {
		const s = accountStore<{ t: string }>("demo")
		await s.save({ t: "x" })
		expect(s.path).toBe(join(dir, "accounts", "demo.json"))
		expect((await stat(s.path)).mode & 0o777).toBe(0o600)
		expect(await s.load()).toEqual({ t: "x" })
		await s.clear()
		expect(await s.load()).toBeNull()
		await s.clear() // второй раз — не ошибка
	})
	test("битый JSON читается как null", async () => {
		const s = accountStore("bad")
		await s.save({ ok: true })
		await Bun.write(s.path, "{not json")
		expect(await s.load()).toBeNull()
	})
})

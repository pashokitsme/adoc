import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../../src/sdk/config.ts"
import { clearTokens, loadTokens, migrateLegacyToken, parsePasted, saveTokens } from "../../../src/providers/autodoc/auth.ts"

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-auth-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

const tokens = { access_token: "a.b.c", refresh_token: "r", expires_at: 1 }

describe("хранение", () => {
	test("save/load/clear через accounts/autodoc.json", async () => {
		expect(await loadTokens()).toBeNull()
		await saveTokens(tokens)
		expect(await Bun.file(join(dir, "accounts", "autodoc.json")).exists()).toBe(true)
		expect(await loadTokens()).toEqual(tokens)
		await clearTokens()
		expect(await loadTokens()).toBeNull()
	})
})

describe("migrateLegacyToken", () => {
	test("переносит token.json, если нового файла нет", async () => {
		await writeFile(join(dir, "token.json"), JSON.stringify(tokens))
		expect(await migrateLegacyToken()).toBe(true)
		expect(await loadTokens()).toEqual(tokens)
		expect(await Bun.file(join(dir, "token.json")).exists()).toBe(false)
	})
	test("не трогает новый файл, если он уже есть", async () => {
		await saveTokens({ ...tokens, access_token: "new" })
		await writeFile(join(dir, "token.json"), JSON.stringify(tokens))
		expect(await migrateLegacyToken()).toBe(false)
		expect((await loadTokens())!.access_token).toBe("new")
	})
	test("нечего переносить — false", async () => {
		expect(await migrateLegacyToken()).toBe(false)
	})
})

describe("parsePasted", () => {
	test("достаёт токены из дампа sessionStorage", () => {
		const dump = JSON.stringify({ authnResult: JSON.stringify({ access_token: "x.y.z", refresh_token: "r", expires_in: 100 }) })
		const p = parsePasted(dump)
		expect(p && "tokens" in p ? p.tokens.access_token : null).toBe("x.y.z")
	})
	test("диагностика SPA распознаётся", () => {
		expect(parsePasted('{"authDiagSnapshot":"could not find matching config for state abc"}')).toEqual({ diag: "abc" })
	})
})

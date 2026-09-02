import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV, accountStore } from "../../src/sdk/index.ts"
import type { Display } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { plainOutput } from "../plain.ts"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "providers")

let dir: string
let restore: () => void
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-acc-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = FIXTURES
	restore = plainOutput()
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_LOGIN
	delete process.env.FAKE_ALPHA_PASSWORD
	delete process.env.FAKE_ALPHA_FAIL
	restore()
	await rm(dir, { recursive: true, force: true })
})

describe("adoc accounts", () => {
	test("без входа — ok:false у всех, код 0", async () => {
		const r = await run(["accounts", "--json"])
		expect(r.code).toBe(0)
		const j = JSON.parse(r.stdout) as { accounts: { provider: string; ok: boolean }[] }
		expect(j.accounts).toEqual([{ provider: "alpha", ok: false }, { provider: "beta", ok: false }])
	})

	test("с аккаунтом — display от провайдера", async () => {
		await accountStore("alpha").save({ token: "t", user: "pavel" })
		const j = JSON.parse((await run(["accounts", "--json"])).stdout) as { accounts: { provider: string; ok: boolean; display?: Display }[] }
		expect(j.accounts.find(a => a.provider === "alpha")).toEqual({ provider: "alpha", ok: true, display: { name: "pavel", email: "pavel@alpha.example" } })
	})

	test("whoami — то же самое", async () => {
		expect(JSON.parse((await run(["whoami", "--json"])).stdout)).toEqual(JSON.parse((await run(["accounts", "--json"])).stdout))
	})

	test("аккаунт без провайдера виден отдельной строкой", async () => {
		await accountStore("ghost").save({ token: "t" })
		const j = JSON.parse((await run(["accounts", "--json"])).stdout) as { orphans: string[] }
		expect(j.orphans).toEqual(["ghost"])
	})

	test("--skip не делает пропущенного провайдера сиротой", async () => {
		await accountStore("beta").save({ token: "t", user: "pavel" })
		const j = JSON.parse((await run(["accounts", "--json", "--skip", "beta"])).stdout) as { accounts: { provider: string }[]; orphans: string[] }
		expect(j.accounts.map(a => a.provider)).toEqual(["alpha"])
		expect(j.orphans).toEqual([])
	})

	test("без провайдеров показывает сирот, а не падает", async () => {
		// Провайдера снесли — именно тогда файл с токенами и остаётся один на
		// диске. Ругаться «не осталось ни одного провайдера» здесь значит
		// спрятать единственное, что ещё можно сделать.
		process.env[PROVIDERS_DIR_ENV] = join(dir, "нет-таких")
		await accountStore("ghost").save({ token: "t" })

		const text = await run(["accounts"])
		expect(text.code).toBe(0)
		expect(text.stdout).toContain("ghost")

		const r = await run(["accounts", "--json"])
		expect(r.code).toBe(0)
		expect(JSON.parse(r.stdout)).toMatchObject({ accounts: [], orphans: ["ghost"] })
	})

	test("файл с недопустимым именем аккаунтом не считается", async () => {
		// id провайдера — только ASCII (ID_RE), поэтому accounts/призрак.json
		// не мог появиться от провайдера: в осиротевшие он не попадает.
		await accountStore("призрак").save({ token: "t" })
		const j = JSON.parse((await run(["accounts", "--json"])).stdout) as { orphans: string[] }
		expect(j.orphans).toEqual([])
	})

	test("таблица для человека маскировкой не занимается", async () => {
		await accountStore("alpha").save({ token: "t", user: "pavel" })
		const r = await run(["accounts"])
		expect(r.stdout).toContain("pavel@alpha.example")
	})
})

describe("adoc login / logout", () => {
	test("login делегирует провайдеру и не печатает токен", async () => {
		process.env.FAKE_ALPHA_LOGIN = "pavel"
		process.env.FAKE_ALPHA_PASSWORD = "pw"
		const r = await run(["login", "alpha", "--json"])
		expect(r.code).toBe(0)
		expect(r.stdout).not.toContain("t-pavel")
		expect(JSON.parse(r.stdout)).toEqual({ ok: true, provider: "alpha", display: { name: "pavel", email: "pavel@alpha.example" } })
		expect(await accountStore("alpha").load()).toEqual({ token: "t-pavel", user: "pavel" })
	})

	test("тело login с токенами не уходит ни в stdout, ни в stderr", async () => {
		process.env.FAKE_ALPHA_LOGIN = "pavel"
		process.env.FAKE_ALPHA_PASSWORD = "pw"
		const r = await run(["login", "alpha"])
		expect(r.stdout).not.toContain("t-pavel")
		// stderr провайдера в интерактивном режиме льётся прямо в терминал, в
		// RunResult он не копится: проверяем то, что здесь правда — обёртка
		// сама не сказала о login ни слова.
		expect(r.stderr).toBe("")
		expect(r.stdout).toContain("вошли")
	})

	test("вошли, а whoami не ответил — так и говорим, а не «не авторизован»", async () => {
		process.env.FAKE_ALPHA_LOGIN = "pavel"
		process.env.FAKE_ALPHA_PASSWORD = "pw"
		process.env.FAKE_ALPHA_FAIL = "http"
		const r = await run(["login", "alpha"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("вошли")
		expect(r.stdout).toContain("whoami не ответил")
		expect(r.stdout).not.toContain("не авторизован")
		expect(await accountStore("alpha").load()).toEqual({ token: "t-pavel", user: "pavel" })
	})

	test("неверный пароль — код 1 и текст провайдера", async () => {
		process.env.FAKE_ALPHA_LOGIN = "pavel"
		process.env.FAKE_ALPHA_PASSWORD = "не тот"
		const r = await run(["login", "alpha", "--json"])
		expect(r.code).toBe(1)
		expect(JSON.parse(r.stdout).error.code).toBe("auth")
	})

	test("login без имени провайдера — bad_args", async () => {
		expect((await run(["login", "--json"])).code).toBe(1)
		expect(JSON.parse((await run(["login", "--json"])).stdout).error.code).toBe("bad_args")
	})

	test("login чужого провайдера — bad_args с перечислением", async () => {
		const r = await run(["login", "гамма", "--json"])
		expect(JSON.parse(r.stdout).error.message).toContain("alpha")
	})

	test("logout удаляет файл аккаунта и говорит, был ли он", async () => {
		await accountStore("alpha").save({ token: "t", user: "pavel" })
		expect(JSON.parse((await run(["logout", "alpha", "--json"])).stdout)).toEqual({ ok: true, provider: "alpha", had: true })
		expect(await accountStore("alpha").load()).toBeNull()
		expect(JSON.parse((await run(["logout", "alpha", "--json"])).stdout).had).toBe(false)
	})

	test("logout забирает и осиротевший файл, провайдера для которого больше нет", async () => {
		await accountStore("ghost").save({ token: "t" })
		expect(JSON.parse((await run(["logout", "ghost", "--json"])).stdout)).toEqual({ ok: true, provider: "ghost", had: true })
		expect(await accountStore("ghost").load()).toBeNull()
	})

	test("logout незнакомого имени — bad_args с перечислением, без похода в store", async () => {
		const r = await run(["logout", "гамма", "--json"])
		expect(r.code).toBe(1)
		const e = JSON.parse(r.stdout).error as { code: string; message: string }
		expect(e.code).toBe("bad_args")
		expect(e.message).toContain("alpha")
	})
})

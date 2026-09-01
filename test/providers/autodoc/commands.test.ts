import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../../src/sdk/config.ts"
import { accountStore } from "../../../src/sdk/account.ts"

const BIN = join(import.meta.dir, "../../../src/providers/autodoc/main.ts")
const FIX = join(import.meta.dir, "../../fixtures/autodoc/http")
let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-cmds-"))
	process.env[CONFIG_DIR_ENV] = dir
	await accountStore("autodoc").save({ access_token: "a.b.c", expires_at: Math.floor(Date.now() / 1000) + 3600 })
})
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

async function run(args: string[], json = true) {
	const proc = Bun.spawn(["bun", BIN, ...args, ...(json ? ["--json"] : [])], {
		env: { ...process.env, [CONFIG_DIR_ENV]: dir, ADOC_FIXTURES: FIX, NO_COLOR: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
	})
	const out = await new Response(proc.stdout).text()
	return { code: await proc.exited, out, json: () => JSON.parse(out) }
}

describe("свои команды autodoc", () => {
	test("goods — сырой ответ", async () => {
		expect((await run(["goods", "408"])).json().totalCount).toBe(183)
	})
	test("--sort не числом — bad_args, а не запрос с NaN", async () => {
		const r = await run(["goods", "408", "--sort", "abc"])
		expect(r.code).toBe(1)
		expect(r.json().error.code).toBe("bad_args")
		expect(r.json().error.message).toBe("--sort: нужно неотрицательное целое число, а не «abc»")
	})
	test("--sort отрицательным — bad_args", async () => {
		expect((await run(["goods", "408", "--sort", "-1"])).json().error.code).toBe("bad_args")
	})
	test("info — карточка и цена", async () => {
		const r = await run(["info", "n90954802"])
		expect(r.json().info.rating.quantity).toBe(56)
		expect(r.json().price.minimalPrice).toBe(317)
	})
	test("info — категория видна и в тексте", async () => {
		const out = (await run(["info", "n90954802"], false)).out
		expect(out).toContain("категория")
		expect(out).toContain("4558")
	})
	test("info --brand по имени", async () => {
		expect((await run(["info", "n90954802", "--brand", "vag"])).code).toBe(0)
	})
	test("garage — список сайта с основной", async () => {
		expect((await run(["garage"])).json().mainCarId).toBe(10)
	})
	test("garage main без id — bad_args", async () => {
		expect((await run(["garage", "main"])).json().error.code).toBe("bad_args")
	})
	test("get — произвольный путь", async () => {
		expect((await run(["get", "/api/goods-service/goods/price", "Article=n90954802", "ManufacturerId=657"])).json().minimalPrice).toBe(317)
	})
	test("таблица без --json", async () => {
		expect((await run(["goods", "408"], false)).out).toContain("KRANZ")
	})
	test("--help перечисляет свои команды", async () => {
		expect((await run(["--help"], false)).out).toContain("garage [parts <carId> | main <carId>]")
	})
})

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import type { Info } from "../../src/core/delta.ts"

type InfoJson = {
	article: string
	brand: string | null
	providers: Record<string, Info>
	errors: { provider: string; code: string }[]
}

let dir: string
let color: string | undefined
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-info-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	// Карточка сверяется как текст: цвета из TTY ломали бы toContain.
	color = process.env.NO_COLOR
	process.env.NO_COLOR = "1"
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_FAIL_INFO
	delete process.env.FAKE_BETA_FAIL_INFO
	if (color === undefined) delete process.env.NO_COLOR
	else process.env.NO_COLOR = color
	await rm(dir, { recursive: true, force: true })
})

const info = async (args: string[]): Promise<InfoJson> =>
	JSON.parse((await run(["info", ...args, "--json"])).stdout) as InfoJson

describe("adoc info", () => {
	test("карточка от каждого сайта, ключ — id провайдера", async () => {
		const j = await info(["n90954802"])
		expect(j.brand).toBe("VAG")
		expect(Object.keys(j.providers)).toEqual(["alpha", "beta"])
		expect(j.providers.alpha).toMatchObject({ article: "N90954802", brand: "VAG", price: 407, deliveryDays: 2 })
		expect(j.providers.beta!.price).toBe(380)
	})

	test("адрес карточки, склады и гистограмма доезжают до JSON", async () => {
		const j = await info(["n90954802"])
		expect(j.providers.alpha!.url).toBe("https://alpha.example/p/N90954802")
		expect(j.providers.alpha!.stock).toEqual([{ code: "MSK", name: "Москва", quantity: 3 }])
		expect(j.providers.alpha!.rating!.histogram).toEqual([8, 1, 1, 0, 0])
	})

	test("в таблице — блок на сайт, адрес в заголовке и склады", async () => {
		const r = await run(["info", "n90954802"])
		expect(r.code).toBe(0)
		// Артикул в заголовке — как его набрали, ровно как у part.
		expect(r.stdout).toContain("alpha · VAG n90954802  https://alpha.example/p/N90954802")
		expect(r.stdout).toContain("beta · VAG n90954802  https://beta.example/p/N%20909%20548%2002")
		expect(r.stdout).toContain("СКЛАД")
		expect(r.stdout).toContain("цена от")
	})

	test("бренд вторым словом и флагом — одно и то же", async () => {
		const a = await info(["MULTI-1", "vag"])
		const b = await info(["MULTI-1", "--brand", "VAG"])
		expect(a.providers.alpha!.article).toBe(b.providers.alpha!.article)
	})

	test("брендов несколько — «уточни бренд» с кодом 2 и подсказкой про info", async () => {
		const r = await run(["info", "MULTI-1"])
		expect(r.code).toBe(2)
		expect(r.stderr).toContain("adoc info <артикул> <бренд>")
	})

	test("один сайт упал — второй показывается, код 0", async () => {
		process.env.FAKE_ALPHA_FAIL_INFO = "http"
		const j = await info(["n90954802"])
		expect(Object.keys(j.providers)).toEqual(["beta"])
		expect(j.errors).toHaveLength(1)
	})

	test("упали все — код 1 и честная строка вместо «карточки нет»", async () => {
		process.env.FAKE_ALPHA_FAIL_INFO = "http"
		process.env.FAKE_BETA_FAIL_INFO = "http"
		const r = await run(["info", "n90954802"])
		expect(r.code).toBe(1)
		expect(r.stdout).toContain("ни один сайт не ответил")
	})

	test("артикула нет ни у кого — пустой ответ и код 0", async () => {
		const r = await run(["info", "нетакого", "--json"])
		expect(r.code).toBe(0)
		expect((JSON.parse(r.stdout) as InfoJson).brand).toBeNull()
	})
})

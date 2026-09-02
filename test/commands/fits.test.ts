import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { GARAGE_FILE, type Garage } from "../../src/core/garage.ts"
import { writeJson } from "../../src/core/store.ts"
import { plainOutput } from "../plain.ts"

type FitsJson = {
	article: string
	brand: string | null
	car: { id: number; name: string; providers: string[] }
	providers: Record<string, { fits: boolean | null; reason?: string; url?: string }>
	errors: { provider: string }[]
}

/** Машина, знакомая обоим сайтам: применимость спрашивают только у своих. */
const garage = (refs: Record<string, Record<string, unknown>>): Promise<void> =>
	writeJson(GARAGE_FILE, {
		mainId: 1, nextId: 2,
		cars: [{ id: 1, brand: "SKODA", model: "OCTAVIA III", year: 2017, refs }],
	} satisfies Garage)

let dir: string
let restore: () => void
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-fits-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	restore = plainOutput()
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_UNKNOWNFIT
	delete process.env.FAKE_ALPHA_FAIL_FITS
	delete process.env.FAKE_ALPHA_EMPTY_CROSSES
	restore()
	await rm(dir, { recursive: true, force: true })
})

const fits = async (args: string[]): Promise<{ code: number; j: FitsJson; stdout: string; stderr: string }> => {
	const r = await run(["fits", ...args, "--json"])
	return { code: r.code, j: JSON.parse(r.stdout) as FitsJson, stdout: r.stdout, stderr: r.stderr }
}

describe("adoc fits", () => {
	test("по строке на сайт: ответ, причина и адрес страницы", async () => {
		await garage({ alpha: { carId: 42 }, beta: { carId: 7 } })
		const { code, j } = await fits(["n90954802"])
		expect(code).toBe(0)
		expect(Object.keys(j.providers)).toEqual(["alpha", "beta"])
		expect(j.providers.alpha).toMatchObject({ fits: true })
		expect(j.providers.alpha!.reason).toContain("42")
		expect(j.providers.alpha!.url).toContain("https://")
		expect(j.car.name).toContain("SKODA")
	})

	test("текстом — «подходит» рядом с именем сайта", async () => {
		await garage({ alpha: { carId: 42 }, beta: { carId: 7 } })
		const r = await run(["fits", "n90954802"])
		expect(r.stdout).toContain("alpha: подходит")
		expect(r.stdout).toContain("beta: подходит")
	})

	test("«не знает» — это ответ, а не отказ: код 0 и совет искать под машину", async () => {
		await garage({ alpha: { carId: 42 } })
		process.env.FAKE_ALPHA_UNKNOWNFIT = "1"
		const r = await run(["fits", "n90954802"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("не знает")
		expect(r.stdout).toContain("adoc search")
	})

	test("сайт без привязки машины не спрашивается, но о нём говорят", async () => {
		await garage({ alpha: { carId: 42 } })
		const { j, stderr } = await fits(["n90954802"])
		expect(Object.keys(j.providers)).toEqual(["alpha"])
		expect(stderr).toContain("нет привязки машины: beta")
	})

	test("сам не подходит, но подходит его кросс — это «подходит через кросс»", async () => {
		await garage({ alpha: { carId: 42 }, beta: { carId: 7 } })
		const { code, j } = await fits(["NOFIT-1"])
		expect(code).toBe(0)
		expect(j.providers.alpha).toMatchObject({ fits: true })
		expect(j.providers.alpha!.reason).toContain("через кросс CROSS-1")
		expect((await run(["fits", "NOFIT-1"])).stdout).toContain("alpha: подходит")
	})

	test("кросс тоже не подходит — остаётся прямой ответ сайта", async () => {
		await garage({ alpha: { carId: 42 } })
		process.env.FAKE_ALPHA_EMPTY_CROSSES = "1"
		const { j } = await fits(["NOFIT-1"])
		expect(j.providers.alpha!.fits).toBe(false)
	})

	test("«не знаю» тоже проверяется кроссом", async () => {
		await garage({ alpha: { carId: 42 } })
		const { j } = await fits(["UNSURE-1"])
		expect(j.providers.alpha).toMatchObject({ fits: true })
		expect(j.providers.alpha!.reason).toContain("через кросс")
	})

	test("гараж пуст — внятный отказ, а не пустая выдача", async () => {
		const r = await run(["fits", "n90954802", "--json"])
		expect(r.code).toBe(1)
		expect(JSON.parse(r.stdout).error.message).toContain("нужна машина")
	})

	test("отказ одного сайта не отменяет ответа второго", async () => {
		await garage({ alpha: { carId: 42 }, beta: { carId: 7 } })
		process.env.FAKE_ALPHA_FAIL_FITS = "http"
		const { code, j } = await fits(["n90954802"])
		expect(code).toBe(0)
		expect(Object.keys(j.providers)).toEqual(["beta"])
		expect(j.errors).toHaveLength(1)
	})

	test("бренд неоднозначен — тот же вопрос, что у part", async () => {
		await garage({ alpha: { carId: 42 }, beta: { carId: 7 } })
		const r = await run(["fits", "MULTI-1"])
		expect(r.code).toBe(2)
		expect(r.stderr).toContain("нужен бренд")
	})
})

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import type { Reviews } from "../../src/sdk/index.ts"

type ReviewsJson = {
	article: string
	brand: string | null
	providers: Record<string, Reviews>
	errors: { provider: string; code: string; message: string }[]
}

let dir: string
let color: string | undefined
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-rev-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	// Отзывы сверяются как текст: escape-последовательности внутри строки
	// ломали бы toContain, если тест запущен из терминала.
	color = process.env.NO_COLOR
	process.env.NO_COLOR = "1"
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_FAIL
	delete process.env.FAKE_BETA_NOREVIEWS
	if (color === undefined) delete process.env.NO_COLOR
	else process.env.NO_COLOR = color
	await rm(dir, { recursive: true, force: true })
})

describe("adoc reviews", () => {
	test("отзывы всех сайтов блоками, ключ — id провайдера", async () => {
		const r = await run(["reviews", "n90954802", "--json"])
		expect(r.code).toBe(0)
		const j = JSON.parse(r.stdout) as ReviewsJson
		expect(j.brand).toBe("VAG")
		expect(Object.keys(j.providers)).toEqual(["alpha", "beta"])
		expect(j.providers.alpha!.items[0]!.text).toBe("отзыв у alpha")
		expect(j.errors).toEqual([])
	})

	test("для человека — заголовок с именем сайта и гистограмма", async () => {
		const r = await run(["reviews", "n90954802"])
		expect(r.stdout).toContain("alpha")
		expect(r.stdout).toContain("отзывов: 1")
		expect(r.stdout).toContain("5★")
	})

	test("бренд неоднозначен — тот же exit 2, что у part", async () => {
		const r = await run(["reviews", "multi1", "--json"])
		expect(r.code).toBe(2)
		expect(JSON.parse(r.stdout).error.code).toBe("ambiguous")
	})

	test("бренд назван — спрашиваем только про него", async () => {
		const j = JSON.parse((await run(["reviews", "multi1", "OTHER", "--json"])).stdout) as ReviewsJson
		expect(j.brand).toBe("OTHER")
		expect(Object.keys(j.providers)).toEqual(["alpha", "beta"])
	})

	test("бренд флагом --brand — то же самое, что вторым словом", async () => {
		const j = JSON.parse((await run(["reviews", "multi1", "--brand", "OTHER", "--json"])).stdout) as ReviewsJson
		expect(j.brand).toBe("OTHER")
		expect(Object.keys(j.providers)).toEqual(["alpha", "beta"])
	})

	test("артикула нет — пустой ответ, код 0", async () => {
		const r = await run(["reviews", "НЕТ-ТАКОГО", "--json"])
		expect(r.code).toBe(0)
		const j = JSON.parse(r.stdout) as ReviewsJson
		expect(j.brand).toBeNull()
		expect(j.providers).toEqual({})
	})

	test("один сайт упал на шаге брендов — отзывы второго всё равно есть", async () => {
		process.env.FAKE_ALPHA_FAIL = "http"
		const j = JSON.parse((await run(["reviews", "n90954802", "--json"])).stdout) as ReviewsJson
		expect(Object.keys(j.providers)).toEqual(["beta"])
		expect(j.errors.map(e => e.provider)).toEqual(["alpha"])
	})

	test("сайт без capability reviews не спрашивается, но назван в stderr", async () => {
		process.env.FAKE_BETA_NOREVIEWS = "1"
		const r = await run(["reviews", "n90954802", "--json"])
		expect(r.code).toBe(0)
		const j = JSON.parse(r.stdout) as ReviewsJson
		expect(Object.keys(j.providers)).toEqual(["alpha"])
		expect(j.errors).toEqual([])
		expect(r.stderr).toContain("beta")
	})

	test("адрес страницы отзывов и адрес самого отзыва доезжают до вывода", async () => {
		const r = await run(["reviews", "n90954802"])
		expect(r.stdout).toContain("alpha · VAG n90954802")
		expect(r.stdout).toContain("https://alpha.example/r/n90954802")
		expect(r.stdout).toContain("https://alpha.example/r/n90954802#1")
	})
})

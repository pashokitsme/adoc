import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { LAST_PART_FILE } from "../../src/core/lastpart.ts"
import { filePath, readJson } from "../../src/core/store.ts"

type PartJson = {
	article: string
	brand: string | null
	brands: { brand: string; providers: string[] }[]
	offers: { provider: string; price: number; article: string }[]
	analogs: { provider: string; article: string }[]
	// Отказ описывается тройкой: без message жёлтая строка и тело --json
	// разошлись бы, а машинный вызов не узнал бы, что именно случилось.
	errors: { provider: string; code: string; message: string }[]
}

let dir: string
let color: string | undefined
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-part-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	// Таблицы сверяются как текст: escape-последовательности внутри ячейки
	// ломали бы toContain, если тест запущен из терминала.
	color = process.env.NO_COLOR
	process.env.NO_COLOR = "1"
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_FAIL
	delete process.env.FAKE_BETA_FAIL
	delete process.env.FAKE_ALPHA_FAIL_OFFERS
	delete process.env.FAKE_BETA_FAIL_OFFERS
	delete process.env.FAKE_ALPHA_EMPTY_OFFERS
	delete process.env.FAKE_BETA_EMPTY_OFFERS
	if (color === undefined) delete process.env.NO_COLOR
	else process.env.NO_COLOR = color
	await rm(dir, { recursive: true, force: true })
})

const part = async (args: string[]): Promise<{ code: number; j: PartJson; stderr: string }> => {
	const r = await run(["part", ...args, "--json"])
	return { code: r.code, j: JSON.parse(r.stdout) as PartJson, stderr: r.stderr }
}

describe("adoc part", () => {
	test("предложения обоих сайтов в одной таблице, дешёвое первым", async () => {
		const { code, j } = await part(["n 909 548 02"])
		expect(code).toBe(0)
		expect(j.brand).toBe("VAG")
		expect(j.offers.map(o => [o.provider, o.price])).toEqual([["beta", 380], ["alpha", 407]])
		expect(j.errors).toEqual([])
	})

	test("таблица для человека показывает провайдера и номер строки", async () => {
		const r = await run(["part", "n90954802"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("ПРОВАЙДЕР")
		expect(r.stdout).toContain("beta")
		expect(r.stdout).toContain("basket add")
	})

	test("бренд неоднозначен — exit 2 и таблица вариантов с колонкой «где»", async () => {
		const r = await run(["part", "multi1"])
		expect(r.code).toBe(2)
		expect(r.stderr).toContain("уточни бренд")
		expect(r.stderr).toContain("ГДЕ")
		expect(r.stderr).toContain("OTHER")
	})

	test("тот же случай в --json — тело ambiguous с items", async () => {
		const r = await run(["part", "multi1", "--json"])
		expect(r.code).toBe(2)
		const e = JSON.parse(r.stdout) as { error: { code: string; items: { brand: string; extra: { providers: string[] } }[] } }
		expect(e.error.code).toBe("ambiguous")
		expect(e.error.items.map(i => i.brand).sort()).toEqual(["OTHER", "VAG"])
		expect(e.error.items[0]!.extra.providers).toEqual(["alpha", "beta"])
	})

	test("один сайт упал, второй просит уточнить бренд — отказ первого не теряется", async () => {
		process.env.FAKE_ALPHA_FAIL = "http"
		const r = await run(["part", "multi1"])
		expect(r.code).toBe(2)
		expect(r.stderr).toContain("alpha")
		expect(r.stderr).toContain("ГДЕ")

		const j = await run(["part", "multi1", "--json"])
		expect(j.code).toBe(2)
		const e = JSON.parse(j.stdout) as { error: { code: string; extra: { errors: { provider: string; code: string; message: string }[] } } }
		expect(e.error.extra.errors).toEqual([{ provider: "alpha", code: "http", message: expect.any(String) }])
	})

	test("названного бренда нет — notfound со списком известных, а не ambiguous", async () => {
		const r = await run(["part", "multi1", "нетакого", "--json"])
		expect(r.code).toBe(1)
		const e = JSON.parse(r.stdout) as { error: { code: string; message: string } }
		expect(e.error.code).toBe("notfound")
		expect(e.error.message).toContain("нетакого")
		expect(e.error.message).toContain("OTHER")
	})

	test("бренд назван — берётся он, регистр не важен", async () => {
		const { code, j } = await part(["multi1", "other"])
		expect(code).toBe(0)
		expect(j.brand).toBe("OTHER")
		expect(j.offers).toHaveLength(2)
	})

	test("бренд можно назвать и флагом --brand", async () => {
		const { code, j } = await part(["multi1", "--brand", "other"])
		expect(code).toBe(0)
		expect(j.brand).toBe("OTHER")
	})

	test("--analogs выносит аналоги отдельным списком", async () => {
		const без = await part(["n90954802"])
		expect(без.j.analogs).toEqual([])
		const с = await part(["n90954802", "--analogs"])
		expect(с.j.analogs.map(o => o.article)).toEqual(["AN-1", "AN-1"])
		expect(с.j.offers).toHaveLength(2)
	})

	test("--only спрашивает только названный сайт", async () => {
		const { j } = await part(["n90954802", "--only", "alpha"])
		expect(j.offers.map(o => o.provider)).toEqual(["alpha"])
		expect(j.brands[0]!.providers).toEqual(["alpha"])
	})

	test("--limit режет таблицу", async () => {
		const { j } = await part(["n90954802", "--limit", "1"])
		expect(j.offers).toHaveLength(1)
		expect(j.offers[0]!.provider).toBe("beta")
	})

	test("один сайт упал — второй печатается, ошибка в errors и жёлтой строкой", async () => {
		process.env.FAKE_ALPHA_FAIL = "auth"
		const { code, j, stderr } = await part(["n90954802"])
		expect(code).toBe(0)
		expect(j.offers.map(o => o.provider)).toEqual(["beta"])
		expect(j.errors).toEqual([{ provider: "alpha", code: "auth", message: expect.any(String) }])
		expect(stderr).toContain("adoc login alpha")
	})

	test("упали все — exit 1", async () => {
		process.env.FAKE_ALPHA_FAIL = "http"
		process.env.FAKE_BETA_FAIL = "http"
		const { code, j } = await part(["n90954802"])
		expect(code).toBe(1)
		expect(j.errors).toHaveLength(2)
	})

	test("ничего не нашлось — это не ошибка", async () => {
		const { code, j } = await part(["НЕТ-ТАКОГО"])
		expect(code).toBe(0)
		expect(j.brand).toBeNull()
		expect(j.offers).toEqual([])
	})

	test("выдача сохраняется в last-part.json в порядке строк таблицы", async () => {
		await run(["part", "n90954802", "--analogs"])
		const saved = await readJson<{ lines: { provider: string; article: string; ref?: unknown }[] }>(LAST_PART_FILE)
		expect(saved!.lines.map(l => [l.provider, l.article])).toEqual([
			["beta", "N 909 548 02"], ["alpha", "N90954802"], ["beta", "AN-1"], ["alpha", "AN-1"],
		])
		expect(saved!.lines[0]!.ref).toEqual({ line: "beta-1" })
	})

	test("шаг offers упал у всех — прошлый кэш не затирается", async () => {
		await run(["part", "n90954802"])
		const before = await readFile(filePath(LAST_PART_FILE), "utf8")

		process.env.FAKE_ALPHA_FAIL_OFFERS = "http"
		process.env.FAKE_BETA_FAIL_OFFERS = "http"
		const { code, j } = await part(["n90954802"])
		expect(code).toBe(1)
		expect(j.brand).toBe("VAG")
		expect(j.offers).toEqual([])
		expect(j.errors.map(e => e.provider).sort()).toEqual(["alpha", "beta"])
		// Байт в байт: `basket add 1` после неудачного запуска обязан класть в
		// корзину ту же строку, что человек читал до него.
		expect(await readFile(filePath(LAST_PART_FILE), "utf8")).toBe(before)
	})

	test("offers упал у одного — таблица второго и кэш по ней", async () => {
		await run(["part", "n90954802"])
		const before = await readFile(filePath(LAST_PART_FILE), "utf8")

		process.env.FAKE_ALPHA_FAIL_OFFERS = "http"
		const { code, j } = await part(["n90954802"])
		expect(code).toBe(0)
		expect(j.offers.map(o => o.provider)).toEqual(["beta"])
		const after = await readFile(filePath(LAST_PART_FILE), "utf8")
		expect(after).not.toBe(before)
		const saved = await readJson<{ lines: { provider: string }[] }>(LAST_PART_FILE)
		expect(saved!.lines.map(l => l.provider)).toEqual(["beta"])
	})

	test("пустая таблица — ни кэша, ни подсказки про basket add", async () => {
		const r = await run(["part", "НЕТ-ТАКОГО"])
		expect(r.code).toBe(0)
		expect(r.stdout).not.toContain("basket add")
		expect(await readJson(LAST_PART_FILE)).toBeNull()
	})

	test("бренд есть, а предложений нет — кэш обнуляется по текущему артикулу", async () => {
		await run(["part", "n90954802"])
		process.env.FAKE_ALPHA_EMPTY_OFFERS = "1"
		process.env.FAKE_BETA_EMPTY_OFFERS = "1"
		const { code, j } = await part(["n90954802"])
		expect(code).toBe(0)
		expect(j.brand).toBe("VAG")
		expect(j.offers).toEqual([])
		const saved = await readJson<{ article: string; lines: unknown[] }>(LAST_PART_FILE)
		expect(saved!.lines).toEqual([])
		// Иначе `basket add 1` молча положил бы строку прошлой выдачи.
		const r = await run(["basket", "add", "1", "--json"])
		expect(r.code).toBe(1)
		const e = JSON.parse(r.stdout) as { error: { code: string; message: string } }
		expect(e.error.code).toBe("bad_args")
		expect(e.error.message).toContain("0 строк")
	})

	test("предложений нет — подсказки про basket add тоже нет", async () => {
		process.env.FAKE_ALPHA_EMPTY_OFFERS = "1"
		process.env.FAKE_BETA_EMPTY_OFFERS = "1"
		const r = await run(["part", "n90954802"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("предложений нет")
		expect(r.stdout).not.toContain("basket add")
	})

	test("аналоги режутся тем же --limit и говорят об этом", async () => {
		const r = await run(["part", "n90954802", "--analogs", "--limit", "1"])
		expect(r.stdout).toContain("показано 1 из 2")
		// Обрезаны обе таблицы — значит, и строк про обрезку две.
		expect(r.stdout.split("показано 1 из 2").length - 1).toBe(2)
	})

	test("без артикула — bad_args", async () => {
		const r = await run(["part", "--json"])
		expect(r.code).toBe(1)
		expect(JSON.parse(r.stdout).error.code).toBe("bad_args")
	})
})

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import { LAST_PART_FILE, lineOf, MAX_AGE_MS, saveLastPart } from "../../src/core/lastpart.ts"
import { readJson } from "../../src/core/store.ts"
import type { OfferRow } from "../../src/core/merge.ts"

const row = (provider: string, price: number, ref?: Record<string, unknown>): OfferRow =>
	({ provider, article: "N90954802", brand: "VAG", name: "Болт", price, currency: "RUB", ...(ref ? { ref } : {}) })

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-last-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

describe("last-part.json", () => {
	test("сохраняются провайдер, цена и ref в порядке строк", async () => {
		await saveLastPart("n90954802", "VAG", [row("beta", 380, { line: "beta-1" }), row("alpha", 407, { line: "alpha-1" })])
		const saved = await readJson<{ article: string; brand: string; lines: { provider: string }[] }>(LAST_PART_FILE)
		expect(saved!.article).toBe("n90954802")
		expect(saved!.brand).toBe("VAG")
		expect(saved!.lines.map(l => l.provider)).toEqual(["beta", "alpha"])
		expect(await lineOf(1)).toMatchObject({ provider: "beta", price: 380, ref: { line: "beta-1" } })
	})

	test("нет файла — понятный отказ, а не пустой ref", async () => {
		await expect(lineOf(1)).rejects.toThrow("adoc part")
	})

	test("выдача пустая — не «нет файла», а «нуль строк»", async () => {
		// Разные беды и разные ответы: файла нет — зови part, файл есть и пуст —
		// у этого артикула предложений не было, класть в корзину нечего.
		await saveLastPart("N1", "VAG", [])
		await expect(lineOf(1)).rejects.toThrow("0 строк")
	})

	test("номер за пределами выдачи", async () => {
		await saveLastPart("N1", "VAG", [row("alpha", 1, { line: "a" })])
		await expect(lineOf(2)).rejects.toThrow("1 строк")
	})

	test("выдача старше суток — просим повторить part", async () => {
		await saveLastPart("N1", "VAG", [row("alpha", 1, { line: "a" })])
		await expect(lineOf(1, Date.now() + MAX_AGE_MS + 1000)).rejects.toThrow("старше суток")
	})

	test("строка без ref в корзину не кладётся", async () => {
		await saveLastPart("N1", "VAG", [row("alpha", 1)])
		await expect(lineOf(1)).rejects.toThrow("ref")
	})
})

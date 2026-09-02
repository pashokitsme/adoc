import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mergeBrands, mergeProducts, splitOffers } from "../../src/core/merge.ts"
import { emptyResult, resolveBrand } from "../../src/core/brand.ts"
import { Ambiguous } from "../../src/core/errors.ts"
import { load, PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import type { Offer } from "../../src/sdk/index.ts"

const offer = (o: Partial<Offer> & { price: number }): Offer =>
	({ article: "N90954802", brand: "VAG", currency: "RUB", ...o })

describe("mergeBrands", () => {
	test("одинаковый бренд с разных сайтов — одна строка, написание у каждого своё", () => {
		const m = mergeBrands("n 909 548 02", [
			{ provider: "alpha", items: [{ brand: "VAG", article: "N90954802", name: "Болт", rating: { average: 4.9, count: 56 } }] },
			{ provider: "beta", items: [{ brand: "vag", article: "N 909 548 02" }] },
		])
		expect(m).toHaveLength(1)
		expect(m[0]!.key).toBe("VAG")
		expect(m[0]!.brand).toBe("VAG")
		expect(m[0]!.providers).toEqual(["alpha", "beta"])
		expect(m[0]!.spelling).toEqual({ alpha: "VAG", beta: "vag" })
		expect(m[0]!.rating).toEqual({ average: 4.9, count: 56 })
	})

	test("позиция про чужой артикул отбрасывается", () => {
		const m = mergeBrands("N1", [{ provider: "alpha", items: [{ brand: "VAG", article: "N1" }, { brand: "BOSCH", article: "N2" }] }])
		expect(m.map(b => b.brand)).toEqual(["VAG"])
	})

	test("порядок: сначала бренды, что есть у большего числа сайтов", () => {
		const m = mergeBrands("N1", [
			{ provider: "alpha", items: [{ brand: "ZZZ", article: "N1" }, { brand: "BOSCH", article: "N1" }] },
			{ provider: "beta", items: [{ brand: "BOSCH", article: "N1" }] },
		])
		expect(m.map(b => b.brand)).toEqual(["BOSCH", "ZZZ"])
	})

	test("рейтинг берётся тот, за которым больше оценок", () => {
		const m = mergeBrands("N1", [
			{ provider: "alpha", items: [{ brand: "VAG", article: "N1", rating: { average: 5, count: 2 } }] },
			{ provider: "beta", items: [{ brand: "VAG", article: "N1", rating: { average: 4.2, count: 300 } }] },
		])
		expect(m[0]!.rating).toEqual({ average: 4.2, count: 300 })
	})
})

describe("splitOffers", () => {
	test("точные — по цене, аналоги отдельно", () => {
		const s = splitOffers("N90954802", [
			{ provider: "alpha", items: [offer({ price: 407 }), offer({ price: 900, article: "AN-1", analog: true })] },
			{ provider: "beta", items: [offer({ price: 380 })] },
		])
		expect(s.offers.map(o => [o.provider, o.price])).toEqual([["beta", 380], ["alpha", 407]])
		expect(s.analogs.map(o => o.article)).toEqual(["AN-1"])
	})

	test("чужой артикул без пометки analog — всё равно аналог", () => {
		const s = splitOffers("N90954802", [{ provider: "alpha", items: [offer({ price: 10, article: "ДРУГОЙ" })] }])
		expect(s.offers).toEqual([])
		expect(s.analogs).toHaveLength(1)
	})

	test("одинаковая цена — порядок по имени провайдера, чтобы выдача не прыгала", () => {
		const s = splitOffers("N90954802", [
			{ provider: "beta", items: [offer({ price: 100 })] },
			{ provider: "alpha", items: [offer({ price: 100 })] },
		])
		expect(s.offers.map(o => o.provider)).toEqual(["alpha", "beta"])
	})
})

describe("mergeProducts", () => {
	test("один товар с двух сайтов — одна строка, цена минимальная", () => {
		const m = mergeProducts([
			{ provider: "alpha", items: [{ article: "N90954802", brand: "VAG", name: "Болт", price: 407, quantity: 3 }] },
			{ provider: "beta", items: [{ article: "N 909 548 02", brand: "vag", name: "Болт", price: 380, quantity: 9 }] },
		])
		expect(m).toHaveLength(1)
		expect(m[0]!.price).toBe(380)
		expect(m[0]!.quantity).toBe(9)
		expect(m[0]!.providers).toEqual(["alpha", "beta"])
		expect(m[0]!.prices).toEqual({ alpha: 407, beta: 380 })
	})

	test("порядок: сначала товары с большего числа сайтов, внутри — по цене", () => {
		const m = mergeProducts([
			{ provider: "alpha", items: [{ article: "A", brand: "X", name: "дешёвый", price: 1 }, { article: "B", brand: "X", name: "общий", price: 100 }] },
			{ provider: "beta", items: [{ article: "B", brand: "X", name: "общий", price: 90 }] },
		])
		expect(m.map(p => p.article)).toEqual(["B", "A"])
	})

	test("товар без цены не ломает сортировку", () => {
		const m = mergeProducts([{ provider: "alpha", items: [{ article: "A", brand: "X", name: "без цены" }] }])
		expect(m[0]!.price).toBeUndefined()
	})
})

describe("resolveBrand", () => {
	let dir: string
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "adoc-brand-"))
		process.env[CONFIG_DIR_ENV] = dir
		process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	})
	afterEach(async () => {
		delete process.env[CONFIG_DIR_ENV]
		delete process.env[PROVIDERS_DIR_ENV]
		delete process.env.FAKE_ALPHA_FAIL
		delete process.env.FAKE_BETA_FAIL
		await rm(dir, { recursive: true, force: true })
	})

	test("бренд один — берётся без вопросов", async () => {
		const { ok } = await load()
		const r = await resolveBrand(ok, "n 909 548 02", undefined, () => {})
		expect(r.brand!.key).toBe("VAG")
		expect(r.brand!.providers).toEqual(["alpha", "beta"])
		expect(r.failures).toEqual([])
	})

	test("брендов несколько и бренд не назван — Ambiguous с вариантами", async () => {
		const { ok } = await load()
		const err = await resolveBrand(ok, "multi1", undefined, () => {}).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(Ambiguous)
		expect((err as Ambiguous).brands.map(b => b.key).sort()).toEqual(["OTHER", "VAG"])
		expect((err as Ambiguous).items!.map(i => i.extra)).toEqual([{ providers: ["alpha", "beta"] }, { providers: ["alpha", "beta"] }])
	})

	test("названный бренд выбирается по ключу, регистр не важен", async () => {
		const { ok } = await load()
		const r = await resolveBrand(ok, "multi1", "other", () => {})
		expect(r.brand!.key).toBe("OTHER")
	})

	test("названного бренда нет — Ambiguous с тем же списком", async () => {
		const { ok } = await load()
		const err = await resolveBrand(ok, "multi1", "нетакого", () => {}).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(Ambiguous)
	})

	test("ничего не нашлось — brand null, а не ошибка", async () => {
		const { ok } = await load()
		const r = await resolveBrand(ok, "ЧЕГО-ТАКОГО-НЕТ", undefined, () => {})
		expect(r.brand).toBeNull()
		expect(r.all).toEqual([])
	})

	test("пустая выдача: код 0, когда кто-то ответил, и 1, когда не ответил никто", async () => {
		const { ok } = await load()
		const quiet = await resolveBrand(ok, "ЧЕГО-ТАКОГО-НЕТ", undefined, () => {})
		expect(emptyResult("ЧЕГО-ТАКОГО-НЕТ", quiet, { offers: [] }, () => {}).code).toBe(0)

		process.env.FAKE_ALPHA_FAIL = "http"
		process.env.FAKE_BETA_FAIL = "http"
		const dead = await resolveBrand((await load()).ok, "n90954802", undefined, () => {})
		expect(emptyResult("n90954802", dead, { offers: [] }, () => {}).code).toBe(1)
		delete process.env.FAKE_BETA_FAIL
	})

	test("один провайдер упал — второй всё равно даёт бренд", async () => {
		process.env.FAKE_ALPHA_FAIL = "http"
		const { ok } = await load()
		const r = await resolveBrand(ok, "n90954802", undefined, () => {})
		expect(r.brand!.providers).toEqual(["beta"])
		expect(r.failures.map(f => f.provider)).toEqual(["alpha"])
	})
})

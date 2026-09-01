import { describe, expect, test } from "bun:test"
import { pickBrand } from "../../../src/providers/autodoc/brand.ts"
import { ProviderError } from "../../../src/sdk/errors.ts"
import type { SearchHit } from "../../../src/providers/autodoc/api.ts"

const hit = (id: number, name: string): SearchHit => ({ article: "N1", goodsName: "Болт", manufacturer: { id, name } })

describe("pickBrand", () => {
	test("один производитель — он", () => {
		expect(pickBrand([hit(657, "VAG")])).toEqual({ id: 657, name: "VAG", goodsName: "Болт" })
	})
	test("числовой id", () => {
		expect(pickBrand([hit(1, "A"), hit(2, "B")], "2").id).toBe(2)
	})
	test("имя без учёта регистра и дефисов", () => {
		expect(pickBrand([hit(1, "MANN-FILTER"), hit(2, "B")], "mann filter").id).toBe(1)
	})
	test("несколько без уточнения — ambiguous с items", () => {
		const e = (() => { try { pickBrand([hit(1, "A"), hit(2, "B")]); return null } catch (x) { return x as ProviderError } })()!
		expect(e.code).toBe("ambiguous")
		expect(e.items?.map(i => i.brand)).toEqual(["A", "B"])
	})
	test("пусто — notfound", () => {
		expect(() => pickBrand([])).toThrow(ProviderError)
	})
})

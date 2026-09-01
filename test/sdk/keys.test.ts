import { describe, expect, test } from "bun:test"
import { articleKey, brandKey } from "../../src/sdk/keys.ts"

describe("articleKey", () => {
	test("регистр и разделители не важны", () => {
		expect(articleKey("n90954802")).toBe("N90954802")
		expect(articleKey("N 909 548 02")).toBe("N90954802")
		expect(articleKey("0 986 452 041")).toBe("0986452041")
		expect(articleKey("W712/75")).toBe("W71275")
	})
	test("кириллица сохраняется", () => {
		expect(articleKey("абв-12")).toBe("АБВ12")
	})
})

describe("brandKey", () => {
	test("регистр, края, внутренние пробелы и дефисы", () => {
		expect(brandKey("VAG")).toBe("VAG")
		expect(brandKey(" vag ")).toBe("VAG")
		expect(brandKey("Mann - Filter")).toBe("MANN FILTER")
		expect(brandKey("MANN-FILTER")).toBe("MANN FILTER")
		expect(brandKey("Bosch  ")).toBe("BOSCH")
	})
})

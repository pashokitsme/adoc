import { describe, expect, test } from "bun:test"
import { ProviderError, errorBody, exitCode, toProviderError } from "../../src/sdk/errors.ts"

describe("ProviderError", () => {
	test("код и exit-код", () => {
		const e = new ProviderError("auth", "нужен вход")
		expect(e.code).toBe("auth")
		expect(exitCode(e.code)).toBe(1)
		expect(exitCode("ambiguous")).toBe(2)
	})
	test("errorBody для ProviderError с items", () => {
		const items = [{ brand: "VAG", article: "N1" }]
		expect(errorBody(new ProviderError("ambiguous", "уточни бренд", items)))
			.toEqual({ error: { code: "ambiguous", message: "уточни бренд", items } })
	})
	test("чужая ошибка — internal", () => {
		expect(errorBody(new Error("boom")).error).toEqual({ code: "internal", message: "boom" })
		expect(errorBody("строка").error).toEqual({ code: "internal", message: "строка" })
	})
	test("toProviderError уважает маппер провайдера", () => {
		const e = toProviderError(new Error("401"), err => err instanceof Error && err.message === "401"
			? new ProviderError("auth", "нужен вход") : null)
		expect(e.code).toBe("auth")
	})
})

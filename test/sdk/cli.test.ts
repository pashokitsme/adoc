import { describe, expect, test } from "bun:test"
import { parseArgv, positiveInt } from "../../src/sdk/cli.ts"
import { ProviderError } from "../../src/sdk/errors.ts"

const code = (fn: () => unknown): string | undefined => {
	try { fn() } catch (e) { return e instanceof ProviderError ? e.code : "не ProviderError" }
	return undefined
}

describe("parseArgv", () => {
	test("позиционные и булевы флаги", () => {
		expect(parseArgv(["brands", "N1", "--json"], [])).toEqual({
			args: ["brands", "N1"], flags: { json: true },
		})
	})
	test("флаги со значением: отдельным аргументом и через =", () => {
		expect(parseArgv(["offers", "N1", "--brand", "VAG", "--limit=5"], ["brand", "limit"])).toEqual({
			args: ["offers", "N1"], flags: { brand: "VAG", limit: "5" },
		})
	})
	test("значение-флаг в конце без значения — bad_args", () => {
		expect(code(() => parseArgv(["x", "--brand"], ["brand"]))).toBe("bad_args")
	})
	test("значение-флаг не съедает следующий флаг", () => {
		// иначе `--page --json` тихо превратился бы в page=\"--json\" без JSON на выходе
		expect(code(() => parseArgv(["search", "болт", "--page", "--json"], ["page"]))).toBe("bad_args")
	})
	test("булев флаг: =true включает, =false как будто не задан", () => {
		expect(parseArgv(["x", "--json=true"], []).flags.json).toBe(true)
		expect(parseArgv(["x", "--json=false"], []).flags).toEqual({})
		expect(parseArgv(["x", "--json", "--json=false"], []).flags).toEqual({})
		expect(parseArgv(["x", "--help=false"], []).flags).toEqual({})
		expect(parseArgv(["x", "--analogs=true"], []).flags.analogs).toBe(true)
	})
	test("булев флаг с другим значением — bad_args", () => {
		expect(code(() => parseArgv(["x", "--json=1"], []))).toBe("bad_args")
		expect(code(() => parseArgv(["x", "--analogs=да"], []))).toBe("bad_args")
	})
	test("-h и --help — help", () => {
		expect(parseArgv(["-h"], []).flags.help).toBe(true)
		expect(parseArgv(["--help"], []).flags.help).toBe(true)
	})
	test("значение с пробелами после = сохраняется целиком", () => {
		expect(parseArgv(["--brand=MANN FILTER"], ["brand"]).flags.brand).toBe("MANN FILTER")
	})
})

describe("positiveInt", () => {
	test("целое ≥ 1", () => {
		expect(positiveInt("--page", "3")).toBe(3)
		expect(positiveInt("--page", "1")).toBe(1)
	})
	test("ноль, дробное, не число и пустое — bad_args", () => {
		for (const v of ["0", "-1", "1.5", "abc", "", undefined, true as const]) {
			expect(code(() => positiveInt("--page", v))).toBe("bad_args")
		}
	})
})

import { describe, expect, test } from "bun:test"
import { parseArgv } from "../../src/sdk/cli.ts"

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
	test("значение-флаг в конце без значения — пустая строка", () => {
		expect(parseArgv(["x", "--brand"], ["brand"]).flags.brand).toBe("")
	})
	test("-h и --help — help", () => {
		expect(parseArgv(["-h"], []).flags.help).toBe(true)
		expect(parseArgv(["--help"], []).flags.help).toBe(true)
	})
	test("значение с пробелами после = сохраняется целиком", () => {
		expect(parseArgv(["--brand=MANN FILTER"], ["brand"]).flags.brand).toBe("MANN FILTER")
	})
})

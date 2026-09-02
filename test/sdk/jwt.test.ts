import { describe, expect, test } from "bun:test"
import { decodeClaims } from "../../src/sdk/jwt.ts"

/** Токен собирается здесь же: настоящий в тесте не нужен и не должен лежать. */
const jwt = (payload: unknown): string => {
	const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url")
	return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`
}

describe("decodeClaims", () => {
	test("читает клеймы, кириллица не портится", () => {
		const claims = decodeClaims<{ unique_name?: string; exp?: number }>(jwt({ unique_name: "Павел Ф.", exp: 2000000000 }))
		expect(claims).toEqual({ unique_name: "Павел Ф.", exp: 2000000000 })
	})
	test("вложенные объекты доезжают целиком", () => {
		expect(decodeClaims<{ data?: { clientId?: string } }>(jwt({ data: { clientId: "abc" } }))?.data?.clientId).toBe("abc")
	})
	test("мусор вместо токена — null, а не исключение", () => {
		expect(decodeClaims("")).toBeNull()
		expect(decodeClaims("nodots")).toBeNull()
		expect(decodeClaims("a.не-base64-json.c")).toBeNull()
	})
})

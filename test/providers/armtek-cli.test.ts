// Провайдер целиком, отдельным процессом: сеть подменена фикстурами, поэтому
// видно то, чего не видно из вызова метода — что ушло в stdout, что в stderr
// и не сломался ли контракт «с --json ровно один объект».

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"

const BIN = join(import.meta.dir, "..", "fixtures", "armtek-cli.ts")
const FIX = join(import.meta.dir, "..", "fixtures", "armtek")
const fix = (name: string) => join(FIX, name)

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-armtek-")) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function run(args: string[], routes: Record<string, string>) {
	const proc = Bun.spawn(["bun", BIN, ...args], {
		env: { ...process.env, [CONFIG_DIR_ENV]: dir, NO_COLOR: "1", ARMTEK_FIXTURES: JSON.stringify(routes) },
		stdin: "ignore", stdout: "pipe", stderr: "pipe",
	})
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
	return { code: await proc.exited, out, err }
}

const guest = { "auth-microservice/v1/guest": fix("guest-token.json") }
/** Точный поиск — одна страница; аналоги — реальные 557 позиций на 16 страницах. */
const paged = { ...guest, "queryType:2": fix("search-exact-bosch.json"), "queryType:1": fix("search-analogs-paged.json") }
const single = { ...guest, "queryType:2": fix("search-exact-bosch.json") }
/** Точных совпадений больше, чем провайдер соглашается пролистать. */
const overflow = { ...guest, "queryType:2": fix("search-exact-overflow.json") }

describe("offers --analogs через CLI", () => {
	test("многостраничные аналоги: один объект в stdout, предупреждение в stderr", async () => {
		const r = await run(["offers", "0986452041", "--brand", "BOSCH", "--analogs", "--json"], paged)
		expect(r.code).toBe(0)

		// контракт: с --json в stdout ровно один JSON-объект и больше ничего
		expect(r.out.trim().split("\n")).toHaveLength(1)
		const j = JSON.parse(r.out) as { items: unknown[]; total?: number }
		expect(Object.keys(j)).toEqual(["items", "total"])
		// сайт насчитал больше, чем поместилось на страницу — это и говорит total
		expect(j.total).toBeGreaterThan(j.items.length)
		expect(j.items.length).toBeGreaterThan(1)

		// а неполнота выдачи — в stderr, где её не спутать с ответом
		expect(r.err).toContain("страниц")
		expect(r.err).toContain("16")
		expect(r.err).toContain("страница 1")
	})

	test("предупреждение есть и без --json", async () => {
		const r = await run(["offers", "0986452041", "--brand", "BOSCH", "--analogs"], paged)
		expect(r.code).toBe(0)
		expect(r.err).toContain("страниц")
		expect(r.out).toContain("аналог")
	})

	test("одна страница — молчим", async () => {
		const r = await run(["offers", "0986452041", "--brand", "BOSCH", "--json"], single)
		expect(r.code).toBe(0)
		expect(r.err.trim()).toBe("")
		expect(JSON.parse(r.out).items).toHaveLength(1)
	})

	test("точная выдача в пределах потолка не жалуется", async () => {
		const r = await run(["brands", "0986452041", "--json"], single)
		expect(r.code).toBe(0)
		expect(r.err.trim()).toBe("")
	})
})

describe("потолок страниц точной выдачи", () => {
	test("упёрлись в потолок — brands предупреждает, но объект отдаёт", async () => {
		const r = await run(["brands", "0986452041", "--json"], overflow)
		expect(r.code).toBe(0)
		expect(r.out.trim().split("\n")).toHaveLength(1)
		expect(JSON.parse(r.out).items.length).toBeGreaterThan(0)
		expect(r.err).toContain("8 страниц")
		expect(r.err).toContain("неполный")
	})

	test("offers предупреждает о том же потолке", async () => {
		const r = await run(["offers", "0986452041", "--brand", "BOSCH", "--json"], overflow)
		expect(r.code).toBe(0)
		expect(r.err).toContain("неполный")
	})
})

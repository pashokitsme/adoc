import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { VALUE_FLAGS } from "../../src/core/help.ts"
import { limitOf } from "../../src/core/args.ts"

let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-help-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	await rm(dir, { recursive: true, force: true })
})

describe("adoc --help", () => {
	test("свои команды и флаги", async () => {
		const r = await run(["--help"])
		expect(r.code).toBe(0)
		for (const s of ["part <артикул>", "info <артикул>", "analogs <артикул>", "search <текст>", "basket add", "orders", "garage import", "providers", "--only", "--analogs"]) {
			expect(r.stdout).toContain(s)
		}
	})

	test("подвал называет ту же величину --limit, что берёт limitOf", async () => {
		expect(limitOf({})).toBe(30)
		expect((await run(["--help"])).stdout).toContain("по умолчанию 30")
	})

	test("подвал перечисляет все флаги обёртки", async () => {
		const r = await run(["--help"])
		for (const f of ["--json", "--only", "--providers", "--skip", "--brand", "--analogs", "--car", "--no-car", "--page", "--limit", "--ref", "--qty", "--id"]) {
			expect(r.stdout).toContain(f)
		}
	})

	test("таблица флагов справки — та же, по которой разбирается argv", async () => {
		// Флаги со значением берутся из одной таблицы: подвал справки и парсер
		// не должны расходиться, как это уже случилось однажды.
		for (const name of ["only", "providers", "skip", "limit", "page", "brand", "qty", "ref", "id", "car"]) {
			expect(VALUE_FLAGS).toContain(name)
			const r = await run(["part", "N1", `--${name}`, "--json"])
			expect(r.code).toBe(1)
			expect(JSON.parse(r.stdout).error.message).toContain("нужно значение")
		}
	})

	test("по строке на каждый найденный сайт, из его describe", async () => {
		const r = await run(["--help"])
		expect(r.stdout).toContain("alpha")
		expect(r.stdout).toContain("Fake beta")
		expect(r.stdout).toContain("https://beta.example")
		expect(r.stdout).toContain("basket")
		expect(r.stdout).toContain("adoc <сайт> --help")
	})

	test("сломанный провайдер виден и в справке", async () => {
		process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "odd")
		const r = await run(["--help"])
		expect(r.stdout).toContain("broken")
		expect(r.stdout).toContain("не отвечает по контракту")
	})

	test("провайдеров нет — справка всё равно печатается", async () => {
		process.env[PROVIDERS_DIR_ENV] = join(dir, "пусто")
		const r = await run(["--help"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("part <артикул>")
		expect(r.stdout).toContain("ни одного не нашлось")
	})

	test("help — такая же справка, как --help", async () => {
		const a = await run(["help"])
		const b = await run(["--help"])
		expect(a.code).toBe(0)
		expect(a.stdout).toBe(b.stdout)
	})

	test("--json без команды — тело ошибки, а не таблица", async () => {
		for (const args of [["--json"], ["--help", "--json"], ["help", "--json"]]) {
			const r = await run(args)
			expect(r.code).toBe(1)
			expect(r.stdout.trim().split("\n")).toHaveLength(1)
			expect(JSON.parse(r.stdout).error.code).toBe("bad_args")
			expect(JSON.parse(r.stdout).error.message).toContain("providers --json")
		}
	})
})

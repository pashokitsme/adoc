import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"

const PROVIDERS_DIR_ENV = "ADOC_PROVIDERS_DIR"

let dir: string
let env: Record<string, string>
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-app-"))
	// Пустой каталог провайдеров: задача 3 заведёт фикстуры, до тех пор набор
	// должен быть пустым, но своим — не настоящим.
	env = { [CONFIG_DIR_ENV]: dir, [PROVIDERS_DIR_ENV]: join(dir, "providers") }
	Object.assign(process.env, env)
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	await rm(dir, { recursive: true, force: true })
})

describe("run", () => {
	test("--help печатает справку обёртки", async () => {
		const r = await run(["--help"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("part")
		expect(r.stdout).toContain("providers")
	})

	test("без аргументов — та же справка", async () => {
		const r = await run([])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("part")
	})

	test("неизвестная команда — bad_args в stderr", async () => {
		const r = await run(["нетакой"])
		expect(r.code).toBe(1)
		expect(r.stdout).toBe("")
		expect(r.stderr).toContain("неизвестная команда")
	})

	test("неизвестная команда с --json — тело ошибки в stdout", async () => {
		const r = await run(["нетакой", "--json"])
		expect(r.code).toBe(1)
		expect(JSON.parse(r.stdout).error.code).toBe("bad_args")
	})

	test("ошибка разбора флагов приходит в том же виде", async () => {
		const r = await run(["part", "N1", "--limit", "--json"])
		expect(r.code).toBe(1)
		expect(JSON.parse(r.stdout).error.code).toBe("bad_args")
	})

	test("--json без команды и с --help — JSON-ошибка, а не справка", async () => {
		for (const argv of [["--help", "--json"], ["--json"]]) {
			const r = await run(argv)
			expect(r.code).toBe(1)
			expect(r.stdout.trim().split("\n")).toHaveLength(1)
			expect(JSON.parse(r.stdout).error.code).toBe("bad_args")
		}
	})

	test("бинарь запускается и печатает справку", async () => {
		const bin = join(import.meta.dir, "..", "..", "src", "main.ts")
		const proc = Bun.spawn(["bun", bin, "--help"], {
			env: { ...process.env, ...env, NO_COLOR: "1" },
			stdin: "ignore", stdout: "pipe", stderr: "pipe",
		})
		const out = await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(0)
		expect(out).toContain("part")
	})

	test("длинный stderr не режется на пайпе", async () => {
		// Bun.spawn отдаёт stderr целиком: обрезание за первым буфером видно
		// только через пайп самой оболочки, поэтому запуск идёт через sh.
		const bin = join(import.meta.dir, "..", "..", "src", "main.ts")
		const cmd = `long=$(head -c 300000 /dev/zero | tr '\\0' x); bun ${JSON.stringify(bin)} "$long" 2>&1 | cat`
		const proc = Bun.spawn(["sh", "-c", cmd], {
			env: { ...process.env, ...env, NO_COLOR: "1" },
			stdin: "ignore", stdout: "pipe", stderr: "pipe",
		})
		// Код возврата у конвейера — от `cat`, поэтому проверяется только целость
		// потока: на обрезании остаётся первый буфер (64 КБ).
		const out = await new Response(proc.stdout).text()
		await proc.exited
		expect(out).toContain("неизвестная команда")
		expect(out.length).toBeGreaterThan(300_000)
	})
})

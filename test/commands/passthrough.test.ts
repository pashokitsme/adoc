import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"

const MAIN = join(import.meta.dir, "..", "..", "src", "main.ts")
const FIXTURES = join(import.meta.dir, "..", "fixtures", "providers")

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-pass-")) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function adoc(args: string[]): Promise<{ code: number; out: string; err: string }> {
	const proc = Bun.spawn(["bun", MAIN, ...args], {
		env: { ...process.env, [CONFIG_DIR_ENV]: dir, [PROVIDERS_DIR_ENV]: FIXTURES, NO_COLOR: "1" },
		stdin: "ignore", stdout: "pipe", stderr: "pipe",
	})
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
	return { code: await proc.exited, out, err }
}

describe("adoc <provider> …", () => {
	test("своя команда провайдера идёт как есть", async () => {
		const r = await adoc(["alpha", "hello", "мир"])
		expect(r.code).toBe(0)
		expect(r.out.trim()).toBe("привет, мир")
	})

	test("--json провайдера не переписывается обёрткой", async () => {
		const r = await adoc(["alpha", "hello", "мир", "--json"])
		expect(JSON.parse(r.out)).toEqual({ hello: "мир" })
	})

	test("--help провайдера — его собственная справка", async () => {
		const r = await adoc(["beta", "--help"])
		expect(r.code).toBe(0)
		expect(r.out).toContain("offers <артикул> --brand")
		expect(r.out).toContain("hello")
	})

	test("код возврата провайдера переносится", async () => {
		const r = await adoc(["alpha", "basket"])
		expect(r.code).toBe(1)
		expect(r.err).toContain("нужен вход")
	})

	test("exit 2 провайдера тоже переносится", async () => {
		const proc = Bun.spawn(["bun", MAIN, "alpha", "brands", "N1"], {
			env: { ...process.env, [CONFIG_DIR_ENV]: dir, [PROVIDERS_DIR_ENV]: FIXTURES, NO_COLOR: "1", FAKE_ALPHA_AMBIGUOUS: "1" },
			stdin: "ignore", stdout: "pipe", stderr: "pipe",
		})
		await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(2)
	})

	test("первое слово — не провайдер: разбирает сама обёртка", async () => {
		const r = await adoc(["providers"])
		expect(r.code).toBe(0)
		expect(r.out).toContain("alpha")
	})

	test("флаг первым словом провайдером не считается", async () => {
		const r = await adoc(["--help"])
		expect(r.out).toContain("part")
	})

	test("голый id провайдера — его собственная справка", async () => {
		const r = await adoc(["beta"])
		expect(r.code).toBe(0)
		expect(r.out).toContain("offers <артикул> --brand")
	})

	test("неизвестное первое слово: ошибка перечисляет и команды, и сайты", async () => {
		const r = await adoc(["нетакой"])
		expect(r.code).toBe(1)
		expect(r.err).toContain("неизвестная команда")
		expect(r.err).toContain("part")
		expect(r.err).toContain("alpha")
		expect(r.err).toContain("beta")
	})

	test("провайдер с именем команды обёртки её не перехватывает", async () => {
		// Исполняемый adoc-part в PATH реестр найдёт, но `adoc part` обязан
		// остаться встроенной командой: иначе чужой бинарь молча подменяет
		// главную команду обёртки.
		const binDir = join(dir, "bin")
		await mkdir(binDir, { recursive: true })
		await writeFile(join(binDir, "adoc-part"), "#!/bin/sh\necho ПЕРЕХВАТ\n", { mode: 0o755 })
		// Без ADOC_PROVIDERS_DIR: он выключает обход PATH целиком. Встроенная
		// команда падает на разборе аргументов раньше, чем спросит провайдеров,
		// поэтому ни один сайт при этом не запускается.
		const env: Record<string, string | undefined> = { ...process.env }
		delete env[PROVIDERS_DIR_ENV]
		const proc = Bun.spawn(["bun", MAIN, "part"], {
			env: { ...env, [CONFIG_DIR_ENV]: dir, PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`, NO_COLOR: "1" },
			stdin: "ignore", stdout: "pipe", stderr: "pipe",
		})
		const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
		expect(await proc.exited).toBe(1)
		expect(out).not.toContain("ПЕРЕХВАТ")
		expect(err).toContain("нужен артикул")
		// И про подменённое имя человеку говорят вслух: иначе непонятно, почему
		// поставленный рядом adoc-part «не работает».
		expect(err).toContain("adoc-part")
	})
})

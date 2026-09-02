import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import { invoke } from "../../src/core/invoke.ts"
import { load, PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "providers")
const ODD = join(import.meta.dir, "..", "fixtures", "odd")
const alpha = ["bun", join(FIXTURES, "alpha", "main.ts")]
const noisy = ["bun", join(ODD, "noisy", "main.ts")]
const sleepy = ["bun", join(import.meta.dir, "..", "fixtures", "sleepy.ts")]
const stubborn = ["bun", join(import.meta.dir, "..", "fixtures", "stubborn.ts")]

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-invoke-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	await rm(dir, { recursive: true, force: true })
})

describe("invoke", () => {
	test("успешный вызов отдаёт разобранный JSON", async () => {
		const r = await invoke(alpha, ["brands", "n90954802"])
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect((r.json as { items: { brand: string }[] }).items[0]!.brand).toBe("VAG")
	})

	test("--json добавляется сам, ровно один раз", async () => {
		const r = await invoke(alpha, ["hello", "мир"])
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect(r.json).toEqual({ hello: "мир" })
	})

	test("свой --json не удваивается", async () => {
		// sh -c: первый операнд после скрипта становится $0, дальше $1…
		const argv = ["sh", "-c", 'printf "{\\"argv\\":\\"$0 $*\\"}"']
		const r = await invoke(argv, ["--json"])
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect((r.json as { argv: string }).argv.trim()).toBe("--json")
	})

	test("тело ошибки провайдера становится InvokeError", async () => {
		const r = await invoke(alpha, ["basket"])
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("auth")
		expect(r.error.message).toContain("нужен вход")
	})

	test("exit 2 с ambiguous доносит items", async () => {
		const r = await invoke(alpha, ["brands", "N90954802"], { env: { FAKE_ALPHA_AMBIGUOUS: "1" } })
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("ambiguous")
		expect(r.error.items).toHaveLength(2)
	})

	test("мусор вокруг JSON отбрасывается с предупреждением, stderr доносится", async () => {
		const r = await invoke(noisy, ["brands", "N1"])
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect(r.json).toEqual({ items: [] })
		expect(r.warnings.join(" ")).toContain("не только JSON")
		expect(r.stderr).toContain("сайт просил подождать")
	})

	test("два JSON-объекта в stdout — ошибка, а не первый попавшийся", async () => {
		const r = await invoke(["sh", "-c", 'printf "{\\"a\\":1}\\n{\\"b\\":2}\\n"'], [])
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("internal")
		expect(r.error.message).toContain("несколько")
	})

	test("два JSON-объекта в одной строке — та же ошибка", async () => {
		const r = await invoke(["sh", "-c", 'printf "{\\"a\\":1} {\\"b\\":2}"'], [])
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("internal")
		expect(r.error.message).toContain("несколько JSON-объектов")
	})

	test("большой stderr не вешает чтение stdout", async () => {
		// Провайдер сначала выливает stderr больше буфера трубы (64 КБ), и лишь
		// потом печатает ответ: читатель по очереди на таком встанет намертво.
		const r = await invoke(noisy, ["brands", "N1"], { env: { NOISY_STDERR_BYTES: "70000" } })
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect(r.json).toEqual({ items: [] })
		expect(r.stderr.length).toBeGreaterThanOrEqual(70_000)
		expect(r.stderr).toContain("сайт просил подождать")
	})

	test("таймаут: провайдер убит, код timeout", async () => {
		const started = Date.now()
		const r = await invoke(sleepy, ["brands", "N1"], { timeoutMs: 300 })
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("timeout")
		expect(Date.now() - started).toBeLessThan(1_500)
	})

	test("SIGTERM проигнорирован — добиваем SIGKILL, код всё равно timeout", async () => {
		const started = Date.now()
		const r = await invoke(stubborn, ["brands", "N1"], { timeoutMs: 200 })
		const spent = Date.now() - started
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("timeout")
		// Мягкий сигнал такого не берёт: ждали отсрочку и добили.
		expect(spent).toBeGreaterThan(1_000)
		expect(spent).toBeLessThan(3_000)
	})

	test("провайдер молча вышел с ненулевым кодом — internal", async () => {
		const r = await invoke(["sh", "-c", "exit 3"], ["brands"])
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("internal")
		expect(r.error.message).toContain("3")
	})

	test("пустой stdout при exit 0 — internal, а не тихий успех", async () => {
		const r = await invoke(["sh", "-c", "exit 0"], ["brands"])
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("internal")
	})

	test("бинаря нет — ошибка в результате, а не исключение наружу", async () => {
		const r = await invoke(["definitely-not-a-real-binary-xyz"], ["describe"], { id: "zombie" })
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("internal")
		expect(r.error.message).toContain("не удалось запустить")
		expect(r.error.message).toContain("definitely-not-a-real-binary-xyz")
	})

	test("exit 2 без тела — internal с именем провайдера, а не выдуманный ambiguous", async () => {
		const r = await invoke(["sh", "-c", "exit 2"], ["brands"], { id: "alpha" })
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("internal")
		expect(r.error.message).toContain("alpha")
		expect(r.error.message).toContain("2")
		expect(r.error.message).toContain("без тела")
		expect(r.error.items).toBeUndefined()
	})

	test("exit 1 без тела называет провайдера", async () => {
		const r = await invoke(["sh", "-c", "exit 1"], ["brands"], { id: "beta" })
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("internal")
		expect(r.error.message).toContain("beta")
	})

	test("смерть от чужого сигнала названа сигналом", async () => {
		const r = await invoke(["sh", "-c", "kill -TERM $$"], [], { id: "alpha" })
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("internal")
		expect(r.error.message).toContain("SIGTERM")
		expect(r.error.message).toContain("alpha")
	})

	test("ADOC_CONFIG_DIR уезжает ребёнку", async () => {
		const r = await invoke(["sh", "-c", `printf '{"dir":"%s"}' "$${CONFIG_DIR_ENV}"`], [])
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect((r.json as { dir: string }).dir).toBe(dir)
	})
})

describe("load", () => {
	test("describe снимается со всех, битый уезжает в bad", async () => {
		process.env[PROVIDERS_DIR_ENV] = FIXTURES
		const { ok, bad } = await load()
		expect(ok.map(p => p.id)).toEqual(["alpha", "beta"])
		expect(ok[0]!.describe.capabilities).toContain("basket")
		expect(bad).toEqual([])
	})

	test("предупреждения и stderr describe доходят до warn", async () => {
		process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "odd")
		const lines: string[] = []
		await load(l => lines.push(l))
		expect(lines.join(" ")).toContain("сайт просил подождать")
		expect(lines.join(" ")).toContain("не только JSON")
	})

	// Каталог провайдеров из симлинков на фикстуры плюс «призрак»: соседи по
	// Promise.all обязаны ответить, даже когда один падает насмерть.
	async function withGhost(fn: (dir: string) => Promise<void>, neighbours = true): Promise<void> {
		const dir = await mkdtemp(join(tmpdir(), "adoc-ghost-"))
		try {
			if (neighbours) for (const id of ["alpha", "beta"]) await symlink(join(FIXTURES, id), join(dir, id))
			await mkdir(join(dir, "ghost"))
			// Не программа: bun такое даже не разберёт.
			await writeFile(join(dir, "ghost", "main.ts"), Buffer.from([0x00, 0x01, 0xff, 0x00]))
			process.env[PROVIDERS_DIR_ENV] = dir
			await fn(dir)
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	}

	test("провайдер, который не запускается, уезжает в bad — соседи отвечают", async () => {
		await withGhost(async () => {
			const { ok, bad } = await load()
			expect(ok.map(p => p.id)).toEqual(["alpha", "beta"])
			expect(bad.map(b => b.id)).toEqual(["ghost"])
			expect(bad[0]!.message).toContain("ghost")
		})
	})

	test("сам spawn упал — это BadProvider, а не исключение из load", async () => {
		// PATH только временный и пустой: `bun` из него не находится, и spawn
		// падает исключением ещё до первого байта. Ничего настоящего при этом не
		// запускается — ADOC_PROVIDERS_DIR отменяет и встроенных, и PATH.
		const empty = await mkdtemp(join(tmpdir(), "adoc-nopath-"))
		const path = process.env.PATH
		try {
			process.env.PATH = empty
			await withGhost(async () => {
				const { ok, bad } = await load()
				expect(ok).toEqual([])
				expect(bad.map(b => b.id)).toEqual(["ghost"])
				expect(bad[0]!.message).toContain("не удалось запустить")
			}, false)
		} finally {
			process.env.PATH = path
			await rm(empty, { recursive: true, force: true })
		}
	})

	test("провайдер с битым describe в агрегацию не попадает", async () => {
		process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "odd")
		const { ok, bad } = await load()
		expect(ok.map(p => p.id)).toEqual(["noisy"])
		expect(bad.map(b => b.id)).toEqual(["broken"])
		expect(bad.find(b => b.id === "broken")!.message).toContain("name")
	})
})

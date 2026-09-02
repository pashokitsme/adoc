import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../../src/sdk/index.ts"
import { autodoc } from "../../../src/providers/autodoc/provider.ts"

const BIN = join(import.meta.dir, "../../../src/providers/autodoc/main.ts")

// Сервер отдаёт соединение и молчит навсегда: ровно то, от чего спасает таймаут.
let server: ReturnType<typeof Bun.serve>
let dir: string
beforeAll(async () => {
	server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => { /* ответа не будет */ }) })
	dir = await mkdtemp(join(tmpdir(), "adoc-timeout-"))
})
afterAll(async () => { server.stop(true); await rm(dir, { recursive: true, force: true }) })

describe("таймаут сети", () => {
	test("зависший сайт — ошибка timeout, а не вечное ожидание", async () => {
		const proc = Bun.spawn(["bun", BIN, "brands", "N1", "--json"], {
			env: {
				...process.env,
				[CONFIG_DIR_ENV]: dir,
				NO_COLOR: "1",
				ADOC_AUTODOC_BASE: `http://localhost:${server.port}`,
				ADOC_TIMEOUT_MS: "300",
			},
			stdin: "ignore", stdout: "pipe", stderr: "pipe",
		})
		const out = await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(1)
		const body = JSON.parse(out) as { error: { code: string; message: string } }
		expect(body.error.code).toBe("timeout")
		expect(body.error.message).toContain("web.autodoc.ru")
	}, 10_000)

	test("фикстурный режим таймаут не трогает", async () => {
		const proc = Bun.spawn(["bun", BIN, "brands", "n90954802", "--json"], {
			env: {
				...process.env,
				[CONFIG_DIR_ENV]: dir,
				NO_COLOR: "1",
				ADOC_FIXTURES: join(import.meta.dir, "../../fixtures/autodoc/http"),
				ADOC_AUTODOC_BASE: `http://localhost:${server.port}`,
				ADOC_TIMEOUT_MS: "300",
			},
			stdin: "ignore", stdout: "pipe", stderr: "pipe",
		})
		const out = await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(0)
		expect((JSON.parse(out) as { items: unknown[] }).items.length).toBeGreaterThan(0)
	}, 10_000)

	test("mapError переводит отмену по таймеру в код timeout", () => {
		const e = autodoc.mapError?.(new DOMException("The operation timed out.", "TimeoutError"))
		expect(e?.code).toBe("timeout")
		expect(autodoc.mapError?.(new Error("что-то другое"))).toBeNull()
	})
})

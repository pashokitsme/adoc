// Цвет и ссылки решаются на каждый вызов, поэтому под pty (bun test в
// терминале) stdout — это TTY, и escape-последовательности были бы включены.
// NO_COLOR гасит цвет одинаково и в пайпе, и в терминале, ADOC_LINKS=list
// оставляет адреса списком под таблицей: строки сравниваются напрямую.
process.env.NO_COLOR = "1"
process.env.ADOC_LINKS = "list"

import { describe, expect, test } from "bun:test"
import { allFailed, blame, failureLine, fanout, report, type Failure } from "../../src/core/partial.ts"
import { accountsTable, providersTable } from "../../src/core/render.ts"
import type { InvokeResult } from "../../src/core/invoke.ts"
import type { Provider } from "../../src/core/registry.ts"

const provider = (id: string): Provider => ({
	id, bin: ["bun", `/x/${id}`], source: "dir",
	describe: { contract: 1, id, name: id, site: "https://x", capabilities: [], commands: [] },
})

const ok = (json: unknown, stderr = "", warnings: string[] = []): InvokeResult => ({ ok: true, json, stderr, warnings })
const bad = (code: Failure["code"], message: string): InvokeResult => ({ ok: false, error: { code, message }, stderr: "", warnings: [] })

const items = (json: unknown): number[] => (json as { items: number[] }).items

describe("fanout", () => {
	test("ответы и отказы разъезжаются по своим спискам", async () => {
		const lines: string[] = []
		const f = await fanout(
			[provider("alpha"), provider("beta")],
			async p => (p.id === "alpha" ? ok({ items: [1] }) : bad("auth", "нужен вход")),
			items,
			l => lines.push(l),
		)
		expect(f.got).toEqual([{ provider: "alpha", value: [1] }])
		expect(f.failures).toEqual([{ provider: "beta", code: "auth", message: "нужен вход" }])
		expect(f.asked).toBe(2)
	})

	test("сломанная форма ответа — отказ этого провайдера, а не всей команды", async () => {
		const f = await fanout([provider("alpha")], async () => ok({ нет: "items" }), j => {
			const v = (j as { items?: unknown }).items
			if (!Array.isArray(v)) throw new Error("нет items")
			return v
		}, () => {})
		expect(f.got).toEqual([])
		expect(f.failures[0]!.code).toBe("internal")
		expect(f.failures[0]!.message).toContain("items")
	})

	test("исключение при самом вызове тоже становится отказом", async () => {
		const f = await fanout([provider("alpha")], async () => { throw new Error("spawn упал") }, items, () => {})
		expect(f.failures[0]!.message).toBe("spawn упал")
	})

	test("stderr провайдера уходит наружу как есть, наши замечания — с префиксом", async () => {
		const lines: string[] = []
		await fanout([provider("alpha")], async () => ok({ items: [] }, "сайт устал\n", ["лишнее в stdout"]), items, l => lines.push(l))
		expect(lines[0]).toBe("сайт устал")
		expect(lines[1]).toContain("adoc: alpha: лишнее в stdout")
	})
})

describe("отчёт об отказах", () => {
	test("auth превращается в подсказку про login", () => {
		expect(failureLine({ provider: "armtek", code: "auth", message: "401" })).toBe("armtek: нужен вход — adoc login armtek")
	})

	test("остальные коды печатают сообщение провайдера", () => {
		expect(failureLine({ provider: "armtek", code: "http", message: "HTTP 500" })).toContain("HTTP 500")
	})

	test("виноватого называем один раз: своё имя в сообщении не дублируется", () => {
		expect(blame("armtek", "HTTP 500")).toBe("armtek: HTTP 500")
		expect(blame("armtek", "провайдер armtek вышел с кодом 1")).toBe("провайдер armtek вышел с кодом 1")
		// id совпадает целым словом: «autodoc.ru» — это не провайдер «auto».
		expect(blame("auto", "HTTP 500 от autodoc.ru")).toBe("auto: HTTP 500 от autodoc.ru")
		// дефис в id допустим (ID_RE) и не должен ломать регулярку под флагом u
		expect(blame("my-shop", "провайдер my-shop вышел с кодом 1")).toBe("провайдер my-shop вышел с кодом 1")
		expect(blame("my-shop", "HTTP 500")).toBe("my-shop: HTTP 500")
		expect(failureLine({ provider: "armtek", code: "http", message: "HTTP 500" })).toBe("armtek: HTTP 500")
		expect(failureLine({ provider: "armtek", code: "internal", message: "провайдер armtek не отдал JSON в stdout" }))
			.toBe("провайдер armtek не отдал JSON в stdout")
	})

	test("упали все — код 1; ответил хоть кто-то — 0", () => {
		const lines: string[] = []
		const none = { got: [], failures: [{ provider: "a", code: "http" as const, message: "x" }], asked: 1 }
		expect(allFailed(none)).toBe(true)
		expect(report(none, [], l => lines.push(l))).toBe(1)
		expect(lines).toHaveLength(1)
		expect(report({ got: [{ provider: "a", value: 1 }], failures: [], asked: 1 }, [], () => {})).toBe(0)
	})

	test("никого не спрашивали — это не отказ", () => {
		expect(allFailed({ got: [], failures: [], asked: 0 })).toBe(false)
	})
})

describe("таблицы обёртки", () => {
	test("providers: capabilities, статус аккаунта и чем запускается", () => {
		const out = providersTable(
			[{ ...provider("alpha"), describe: { contract: 1, id: "alpha", name: "Alpha", site: "https://a", capabilities: ["basket"], commands: [] } }],
			[{ id: "broken", bin: ["bun", "/x/broken"], source: "dir", message: "нет поля name" }],
			new Set(["alpha"]),
		)
		const lines = out.split("\n")
		expect(lines[0]).toContain("АККАУНТ")
		expect(lines[1]).toContain("basket")
		expect(lines[1]).toContain("есть")
		expect(lines[2]).toContain("нет поля name")
	})

	test("providers: ни одного — не пустая таблица, а совет", () => {
		expect(providersTable([], [], new Set())).toContain("PATH")
	})

	test("accounts: имя и почта печатаются как есть, отказ — примечанием", () => {
		const out = accountsTable([
			{ provider: "alpha", ok: true, display: { name: "pavel", email: "pavel@alpha.example" } },
			{ provider: "beta", ok: false, note: "HTTP 500" },
			{ provider: "gamma", ok: false },
		])
		expect(out).toContain("pavel@alpha.example")
		expect(out).toContain("HTTP 500")
		expect(out).toContain("входа нет")
		// Колонки прибиты целиком: ширина считается по всем строкам вместе с
		// заголовком, хвост строки обрезается.
		expect(out.split("\n")[1]).toBe("alpha      вход есть  pavel  pavel@alpha.example  —")
	})

	test("accounts: пустой список", () => {
		expect(accountsTable([])).toBe("аккаунтов нет")
	})
})

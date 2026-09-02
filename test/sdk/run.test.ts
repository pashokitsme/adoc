import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { accountStore } from "../../src/sdk/account.ts"

const BIN = join(import.meta.dir, "..", "fixtures", "fake-provider.ts")
let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-run-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

async function run(args: string[], env: Record<string, string> = {}) {
	const proc = Bun.spawn(["bun", BIN, ...args], {
		env: { ...process.env, [CONFIG_DIR_ENV]: dir, NO_COLOR: "1", ...env },
		stdin: "ignore", stdout: "pipe", stderr: "pipe",
	})
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
	const code = await proc.exited
	return { code, out, err, json: () => JSON.parse(out) }
}

describe("runProvider", () => {
	test("describe собирается из объявления", async () => {
		const r = await run(["describe", "--json"])
		expect(r.code).toBe(0)
		const d = r.json()
		expect(d.contract).toBe(1)
		expect(d.id).toBe("fake")
		expect(d.capabilities).toEqual(["reviews", "garage", "basket"])
		const names = d.commands.map((c: { name: string }) => c.name)
		expect(names).toEqual(expect.arrayContaining(["login", "whoami", "search", "brands", "offers", "reviews", "garage export", "basket", "basket add", "echo"]))
		expect(d.commands.find((c: { name: string }) => c.name === "echo").usage).toBe("echo <текст> [--echo <x>]")
	})

	test("--json печатает ровно один объект и ничего больше", async () => {
		const r = await run(["brands", "N1", "--json"])
		expect(r.code).toBe(0)
		expect(r.out.trim().split("\n")).toHaveLength(1)
		expect(r.json()).toEqual({ items: [{ brand: "VAG", article: "N1", name: "Болт" }] })
	})

	test("без --json — таблица", async () => {
		const r = await run(["brands", "N1"])
		expect(r.code).toBe(0)
		expect(r.out).toContain("БРЕНД")
		expect(r.out).toContain("VAG")
	})

	test("пустой результат — exit 0", async () => {
		const r = await run(["brands", "ZZZ", "--json"])
		expect(r.code).toBe(0)
		expect(r.json()).toEqual({ items: [] })
	})

	test("ambiguous — exit 2 с items", async () => {
		const r = await run(["brands", "AMB", "--json"])
		expect(r.code).toBe(2)
		expect(r.json().error.code).toBe("ambiguous")
		expect(r.json().error.items).toHaveLength(2)
	})

	test("offers без --brand — bad_args", async () => {
		const r = await run(["offers", "N1", "--json"])
		expect(r.code).toBe(1)
		expect(r.json().error.code).toBe("bad_args")
	})

	test("offers без аккаунта — auth; с аккаунтом — предложения; --analogs добавляет аналог", async () => {
		let r = await run(["offers", "N1", "--brand", "VAG", "--json"])
		expect(r.json().error.code).toBe("auth")
		await accountStore("fake").save({ token: "t", user: "u" })
		r = await run(["offers", "N1", "--brand", "VAG", "--json"])
		expect(r.code).toBe(0)
		expect(r.json().items).toHaveLength(1)
		r = await run(["offers", "N1", "--brand", "VAG", "--analogs", "--json"])
		expect(r.json().items).toHaveLength(2)
	})

	test("login без tty — tty", async () => {
		const r = await run(["login", "--json"])
		expect(r.code).toBe(1)
		expect(r.json().error.code).toBe("tty")
	})

	test("login без tty проходит, когда провайдер берёт данные из окружения", async () => {
		const r = await run(["login", "--json"], { FAKE_LOGIN: "pavel", FAKE_PASSWORD: "pw" })
		expect(r.code).toBe(0)
		expect(r.json()).toEqual({ account: { token: "t-pavel", user: "pavel" }, display: { name: "pavel" } })
		expect(await accountStore("fake").load()).toEqual({ token: "t-pavel", user: "pavel" })
	})

	test("whoami: ok=false без аккаунта, ok=true с ним", async () => {
		expect((await run(["whoami", "--json"])).json()).toEqual({ ok: false })
		await accountStore("fake").save({ token: "t", user: "pavel" })
		expect((await run(["whoami", "--json"])).json()).toEqual({ ok: true, display: { name: "pavel" } })
	})

	test("logout удаляет файл аккаунта", async () => {
		await accountStore("fake").save({ token: "t", user: "pavel" })
		const r = await run(["logout", "--json"])
		expect(r.code).toBe(0)
		expect(await accountStore("fake").load()).toBeNull()
	})

	test("search и reviews", async () => {
		expect((await run(["search", "болт", "--json"])).json().items).toHaveLength(1)
		expect((await run(["reviews", "N1", "--brand", "VAG", "--json"])).json().total).toBe(1)
	})

	test("garage export", async () => {
		expect((await run(["garage", "export", "--json"])).json().cars[0].brand).toBe("SKODA")
	})

	test("basket add/set/rm", async () => {
		let r = await run(["basket", "add", "--ref", JSON.stringify({ priceId: 7 }), "--qty", "2", "--json"])
		expect(r.code).toBe(0)
		expect(r.json().items[0]).toMatchObject({ id: "7", quantity: 2 })
		r = await run(["basket", "add", "--ref", "{bad", "--json"])
		expect(r.json().error.code).toBe("bad_args")
		r = await run(["basket", "set", "7", "--json"])
		expect(r.json().error.code).toBe("bad_args")
	})

	test("своя команда: json и рендер, флаг со значением", async () => {
		let r = await run(["echo", "a", "b", "--echo", "x", "--json"])
		expect(r.json()).toEqual({ args: ["a", "b"], echo: "x" })
		r = await run(["echo", "a"])
		expect(r.out.trim()).toBe("echo: a")
	})

	test("чужая ошибка — internal с текстом", async () => {
		const r = await run(["boom", "--json"])
		expect(r.code).toBe(1)
		expect(r.json().error).toEqual({ code: "internal", message: "взрыв" })
	})

	test("HttpError из SDK — код http, а не internal", async () => {
		const r = await run(["http", "--json"])
		expect(r.code).toBe(1)
		expect(r.json().error.code).toBe("http")
		expect(r.json().error.message).toContain("HTTP 500")
	})

	test("неизвестная команда — bad_args; без --json текст в stderr", async () => {
		const r = await run(["nope"])
		expect(r.code).toBe(1)
		expect(r.out).toBe("")
		expect(r.err).toContain("неизвестная команда")
		// имя из прототипа Object не должно притвориться командой провайдера
		expect((await run(["toString", "--json"])).json().error.code).toBe("bad_args")
	})

	test("большой ответ не режется на пайпе", async () => {
		// Bun.spawn отдаёт stdout целиком, обрезание видно только через пайп самой оболочки
		const proc = Bun.spawn(["sh", "-c", `bun ${JSON.stringify(BIN)} big --json | cat`], {
			env: { ...process.env, [CONFIG_DIR_ENV]: dir, NO_COLOR: "1" },
			stdin: "ignore", stdout: "pipe", stderr: "pipe",
		})
		const out = await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(0)
		const d = JSON.parse(out) as { s: string } // на обрезанном выводе упадёт здесь
		expect(d.s).toHaveLength(200_000)
		expect(out.length).toBeGreaterThan(200_000)
	})

	test("--json без команды и с --help — JSON-ошибка, а не таблица", async () => {
		for (const args of [["--help", "--json"], ["--json"]]) {
			const r = await run(args)
			expect(r.code).toBe(1)
			expect(r.out.trim().split("\n")).toHaveLength(1)
			expect(r.json().error.code).toBe("bad_args")
		}
	})

	test("--help печатает usage со своими командами", async () => {
		const r = await run(["--help"])
		expect(r.code).toBe(0)
		expect(r.out).toContain("echo <текст>")
		expect(r.out).toContain("offers <артикул> --brand")
	})
})

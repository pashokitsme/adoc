import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV, NO_WARN_ENV } from "../../src/sdk/config.ts"
import { accountStore } from "../../src/sdk/account.ts"

const BIN = join(import.meta.dir, "..", "fixtures", "fake-provider.ts")
let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-run-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

async function run(args: string[], env: Record<string, string> = {}) {
	const proc = Bun.spawn(["bun", BIN, ...args], {
		env: { ...process.env, [CONFIG_DIR_ENV]: dir, NO_COLOR: "1", ADOC_LINKS: "list", ...env },
		stdin: "ignore", stdout: "pipe", stderr: "pipe",
	})
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
	const code = await proc.exited
	return { code, out, err, json: () => JSON.parse(out) }
}

describe("предупреждения провайдера", () => {
	test("одна и та же заметка за запуск печатается один раз", async () => {
		const r = await run(["search", "болт"], { FAKE_WARN: "1" })
		expect(r.code).toBe(0)
		expect(r.err.split("fake: заметка").length - 1).toBe(1)
	})

	test("ADOC_NO_WARN гасит их совсем, не трогая выдачу и код", async () => {
		const r = await run(["search", "болт", "--json"], { FAKE_WARN: "1", [NO_WARN_ENV]: "1" })
		expect(r.err).toBe("")
		expect(r.code).toBe(0)
		expect(r.json().items).toHaveLength(1)
	})
})

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
			env: { ...process.env, [CONFIG_DIR_ENV]: dir, NO_COLOR: "1", ADOC_LINKS: "list" },
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

	test("--page и --limit: только целое ≥ 1", async () => {
		for (const v of ["0", "-1", "1.5", "abc"]) {
			const r = await run(["search", "болт", "--page", v, "--json"])
			expect(r.code).toBe(1)
			expect(r.json().error.code).toBe("bad_args")
		}
		const r = await run(["search", "болт", "--limit", "0", "--json"])
		expect(r.json().error.code).toBe("bad_args")
	})

	test("флаг со значением не съедает следующий флаг, а ошибка всё равно JSON", async () => {
		const r = await run(["search", "болт", "--page", "--json"])
		expect(r.code).toBe(1)
		expect(r.out.trim().split("\n")).toHaveLength(1)
		expect(r.json().error.code).toBe("bad_args")
		expect(r.json().error.message).toContain("--page")
	})

	test("--json=false — как будто флага нет, --json=1 — bad_args", async () => {
		const plain = await run(["brands", "N1", "--json=false"])
		expect(plain.code).toBe(0)
		expect(plain.out).toContain("БРЕНД")
		const bad = await run(["brands", "N1", "--json=1"])
		expect(bad.code).toBe(1)
		expect(bad.err).toContain("--json")
	})

	test("--help печатает usage со своими командами", async () => {
		const r = await run(["--help"])
		expect(r.code).toBe(0)
		expect(r.out).toContain("echo <текст>")
		expect(r.out).toContain("offers <артикул> --brand")
	})
})

describe("info, analogs, orders и --car", () => {
	test("info — карточка и одна её форма в JSON", async () => {
		const r = await run(["info", "N1", "--brand", "VAG", "--json"])
		expect(r.code).toBe(0)
		expect(r.json().info).toMatchObject({ article: "N1", brand: "VAG", name: "Болт" })
		const human = await run(["info", "N1", "--brand", "VAG"])
		expect(human.out).toContain("Болт")
		expect(human.out).toContain("https://fake.example/part/n1")
	})

	test("info без --brand — bad_args", async () => {
		const r = await run(["info", "N1", "--json"])
		expect(r.code).toBe(1)
		expect(r.json().error.code).toBe("bad_args")
	})

	test("analogs — только аналоги", async () => {
		const r = await run(["analogs", "N1", "--brand", "VAG", "--json"])
		expect(r.json().items.every((o: { analog?: boolean }) => o.analog)).toBe(true)
	})

	test("orders нет у провайдера без capability — bad_args", async () => {
		const r = await run(["orders", "--json"])
		expect(r.code).toBe(1)
		expect(r.json().error.code).toBe("bad_args")
	})

	test("--car доезжает до провайдера объектом", async () => {
		const r = await run(["search", "болт", "--car", '{"carId":1}', "--json"])
		expect(r.code).toBe(0)
		expect(r.json().items).toHaveLength(1)
	})

	test("--car не JSON — bad_args с именем своего флага", async () => {
		const r = await run(["search", "болт", "--car", "1", "--json"])
		expect(r.code).toBe(1)
		expect(r.json().error.message).toContain("--car")
	})

	test("describe объявляет info и analogs", async () => {
		const names = (await run(["describe", "--json"])).json().commands.map((c: { name: string }) => c.name)
		expect(names).toEqual(expect.arrayContaining(["info", "analogs"]))
		expect(names).not.toContain("orders")
	})
})

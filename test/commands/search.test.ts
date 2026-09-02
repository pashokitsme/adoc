import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { GARAGE_FILE, type Garage } from "../../src/core/garage.ts"
import { writeJson } from "../../src/core/store.ts"
import { plainOutput } from "../plain.ts"

type SearchJson = {
	query: string
	car: { id: number; name: string; providers: string[]; borrowed?: string[]; from?: string } | null
	items: { article: string; name: string; providers: string[]; price?: number; prices: Record<string, number>; urls: Record<string, string> }[]
	errors: { provider: string }[]
}

// Гараж, в котором машина знакома только alpha: на нём проверяется и подбор,
// и предупреждение про сайт без привязки.
const oneCarGarage = (refs: Record<string, Record<string, unknown>> = { alpha: { carId: 42 } }): Promise<void> =>
	writeJson(GARAGE_FILE, {
		mainId: 1, nextId: 2,
		cars: [{ id: 1, brand: "SKODA", model: "OCTAVIA III", year: 2017, refs }],
	} satisfies Garage)

let dir: string
let restore: () => void
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-search-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	restore = plainOutput()
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_FAIL
	delete process.env.FAKE_BETA_FAIL
	delete process.env.FAKE_ALPHA_NOCAR
	delete process.env.FAKE_BETA_EMPTY_SEARCH
	delete process.env.FAKE_ALPHA_MORE
	restore()
	await rm(dir, { recursive: true, force: true })
})

const search = async (args: string[]): Promise<SearchJson> =>
	JSON.parse((await run(["search", ...args, "--json"])).stdout) as SearchJson

describe("adoc search", () => {
	test("общий товар — одна строка с двумя сайтами и минимальной ценой", async () => {
		const j = await search(["болт"])
		expect(j.query).toBe("болт")
		expect(j.items[0]!.providers).toEqual(["alpha", "beta"])
		expect(j.items[0]!.price).toBe(380)
		expect(j.items[0]!.prices).toEqual({ alpha: 407, beta: 380 })
	})

	test("свои товары каждого сайта тоже в списке, но ниже общего", async () => {
		const j = await search(["болт"])
		expect(j.items.map(i => i.article)).toEqual(["N90954802", "ALPHA-ONLY", "BETA-ONLY"])
	})

	test("таблица показывает колонку ГДЕ и подсказку про part", async () => {
		const r = await run(["search", "болт"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("ГДЕ")
		expect(r.stdout).toContain("adoc part")
	})

	test("ничего не нашлось — пустой список и код 0", async () => {
		const r = await run(["search", "такого нет", "--json"])
		expect(r.code).toBe(0)
		expect((JSON.parse(r.stdout) as SearchJson).items).toEqual([])
	})

	test("--limit режет итоговый список", async () => {
		const j = await search(["болт", "--limit", "2"])
		expect(j.items).toHaveLength(2)
	})

	test("запрос из нескольких слов не теряется", async () => {
		const j = await search(["такого", "нет"])
		expect(j.query).toBe("такого нет")
	})

	test("один сайт упал — второй показывается", async () => {
		process.env.FAKE_ALPHA_FAIL = "http"
		const j = await search(["болт"])
		expect(j.items.every(i => i.providers.every(p => p === "beta"))).toBe(true)
		expect(j.errors).toHaveLength(1)
	})

	test("упали все — exit 1", async () => {
		process.env.FAKE_ALPHA_FAIL = "http"
		process.env.FAKE_BETA_FAIL = "http"
		expect((await run(["search", "болт", "--json"])).code).toBe(1)
	})

	test("первый адрес — в списке SDK, второй сайт строки — в «ещё ссылки»", async () => {
		const r = await run(["search", "болт"])
		expect(r.stdout).toContain("1  https://alpha.example/p/N90954802")
		expect(r.stdout).toContain("ещё ссылки")
		expect(r.stdout).toContain("1  beta  https://beta.example/p/N%20909%20548%2002")
	})

	test("в osc8 адреса сайтов вшиты в колонку ГДЕ, а «ещё ссылок» нет", async () => {
		process.env.ADOC_LINKS = "osc8"
		const r = await run(["search", "болт"])
		const hyperlink = (text: string, url: string): string => `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`
		expect(r.stdout).toContain(hyperlink("alpha", "https://alpha.example/p/N90954802"))
		expect(r.stdout).toContain(hyperlink("beta", "https://beta.example/p/N%20909%20548%2002"))
		expect(r.stdout).not.toContain("ещё ссылки")
		// голого адреса на экране не остаётся: он весь внутри escape
		expect(r.stdout.replace(/\x1b\]8;;[^\x07\x1b]*(\x1b\\|\x07)/g, "")).not.toContain("https://")
	})

	test("добавка сайта доезжает до --json под именем сайта", async () => {
		const r = await run(["search", "болт", "--json"])
		const j = JSON.parse(r.stdout) as { extra: Record<string, { note?: string }> }
		// фейк кладёт в extra свою заметку — у autodoc там id категорий
		expect(j.extra.alpha).toBeDefined()
	})

	test("всё показанное — без строки об остатке: остатка нет", async () => {
		// Оба фейка отдали всё, что у них есть, склейка свела одинаковый товар
		// в одну строку — прятать нечего, и подпись была бы шумом.
		const r = await run(["search", "болт"])
		expect(r.stdout).not.toContain("всего у сайтов")
	})

	test("у сайта строк больше, чем он отдал — подпись об этом есть", async () => {
		process.env.FAKE_ALPHA_MORE = "20"
		const r = await run(["search", "болт"])
		expect(r.stdout).toContain("всего у сайтов 22")
		expect(r.stdout).toContain("--page <n>")
	})

	test("страница за концом выдачи говорит, сколько всего и где искать", async () => {
		process.env.FAKE_ALPHA_MORE = "20"
		const r = await run(["search", "болт", "--page", "9"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("страница 9 пуста: всего 20")
		expect(r.stdout).toContain("--limit 30")
		expect(r.stdout).not.toContain("ничего не найдено")
	})

	test("страница за концом, а итога сайты не назвали — честное «кончилась»", async () => {
		const r = await run(["search", "болт", "--page", "9"])
		expect(r.stdout).toContain("на первой странице выдача кончилась")
	})

	test("адреса обоих сайтов лежат в JSON одной строкой выдачи", async () => {
		const j = await search(["болт"])
		expect(j.items[0]!.urls).toEqual({
			alpha: "https://alpha.example/p/N90954802",
			beta: "https://beta.example/p/N%20909%20548%2002",
		})
	})

	test("без гаража ищем без машины и зовём импорт", async () => {
		const r = await run(["search", "болт"])
		expect(r.stdout).toContain("garage import")
		expect((await search(["болт"])).car).toBeNull()
	})

	test("основная машина гаража уходит сайту его же ref-ом", async () => {
		await oneCarGarage()
		const j = await search(["болт"])
		expect(j.car).toEqual({ id: 1, name: "SKODA OCTAVIA III 2017", providers: ["alpha"] })
		// Фейк кладёт в выдачу строку с carId из полученного ref.
		expect(j.items.some(i => i.name === "под машину 42")).toBe(true)
	})

	test("сайту без привязки говорим об этом один раз", async () => {
		await oneCarGarage()
		const r = await run(["search", "болт"])
		expect(r.stderr).toContain("без машины ищут: beta")
		expect(r.stdout).toContain("машина: SKODA OCTAVIA III 2017")
	})

	test("сайт ответил пустым списком — назван в stderr, но не в errors", async () => {
		process.env.FAKE_BETA_EMPTY_SEARCH = "1"
		const r = await run(["search", "болт"])
		expect(r.stderr).toContain("ничего не нашли: beta")
		expect((JSON.parse((await run(["search", "болт", "--json"])).stdout) as SearchJson).errors).toEqual([])
	})

	test("не нашлось ни у кого — про пустые сайты молчим", async () => {
		const r = await run(["search", "такого нет"])
		expect(r.stderr).not.toContain("ничего не нашли")
		expect(r.stdout).toContain("ничего не найдено")
	})

	test("--no-car выключает подбор", async () => {
		await oneCarGarage()
		const j = await search(["болт", "--no-car"])
		expect(j.car).toBeNull()
		expect(j.items.some(i => i.name.startsWith("под машину"))).toBe(false)
	})

	test("--car <id> берёт названную машину, чужой номер — bad_args", async () => {
		await oneCarGarage()
		expect((await search(["болт", "--car", "1"])).car!.id).toBe(1)
		const r = await run(["search", "болт", "--car", "9"])
		expect(r.code).toBe(1)
		expect(r.stderr).toContain("нет машины 9")
	})

	test("модификация TecDoc из чужой привязки достаётся сайту без своей", async () => {
		// autodoc зовёт её modificationId, armtek — linkingTargetId, число одно.
		await oneCarGarage({ alpha: { carId: 42, modificationId: 58759 } })
		const j = await search(["болт"])
		expect(j.car).toEqual({ id: 1, name: "SKODA OCTAVIA III 2017", providers: ["alpha", "beta"], borrowed: ["beta"], from: "alpha" })
		// alpha ищет по своему carId, beta — по одолженной модификации.
		expect(j.items.some(i => i.name === "под машину 42")).toBe(true)
		expect(j.items.some(i => i.name === "под машину 58759")).toBe(true)
		const r = await run(["search", "болт"])
		expect(r.stdout).toContain("beta (через alpha)")
		expect(r.stderr).not.toContain("без машины ищут")
	})

	test("ref без модификации TecDoc не одалживается", async () => {
		await oneCarGarage({ alpha: { carId: 42 } })
		expect((await search(["болт"])).car!.providers).toEqual(["alpha"])
	})

	test("сайт не умеет искать по машине — его предупреждение доезжает до человека", async () => {
		process.env.FAKE_ALPHA_NOCAR = "1"
		await oneCarGarage()
		const r = await run(["search", "болт"])
		expect(r.stderr).toContain("alpha: поиск по машине не поддерживается")
	})
})

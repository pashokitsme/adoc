// contract.test.ts — единственный тест плана, который запускает не фикстуру, а
// настоящих встроенных провайдеров: autodoc и armtek. Говорим с ними ровно так
// же, как агрегатор, — через invoke и валидаторы контракта, — поэтому падение
// здесь значит одно из двух: провайдер сломал форму ответа или у него пропал
// фикстурный режим. Сети нет ни у кого: у autodoc её подменяет ADOC_FIXTURES,
// у armtek — транспорт из test/fixtures/armtek-cli.ts, который на незнакомый
// URL бросает.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV, accountStore, articleKey } from "../../src/sdk/index.ts"
import type { Capability } from "../../src/sdk/index.ts"
import { invoke } from "../../src/core/invoke.ts"
import { parseBasket, parseBrands, parseDescribe, parseOffers, parseWhoami } from "../../src/core/validate.ts"

const root = join(import.meta.dir, "..", "..")
const armtekFix = (name: string): string => join(root, "test", "fixtures", "armtek", name)

/**
 * Гостевой токен нужен armtek на любой запрос без входа; точная выдача — одна
 * страница; корзина — записанное состояние точки выдачи ME86.
 */
const armtekRoutes = {
	"auth-microservice/v1/guest": armtekFix("guest-token.json"),
	"queryType:2": armtekFix("search-exact-bosch.json"),
	"cart-microservice/v1/base": armtekFix("cart-list.json"),
}

const soon = (): number => Math.floor(Date.now() / 1000) + 3600

type Case = {
	id: string
	bin: string[]
	env: Record<string, string>
	article: string
	brand: string
	/** Фиктивный аккаунт: сеть подменена, поэтому токен может быть любым. */
	account: () => Promise<void>
	/** Нужен ли провайдеру аккаунт, чтобы отдать offers. */
	authOffers: boolean
}

const cases: Case[] = [
	{
		id: "autodoc",
		bin: ["bun", join(root, "src", "providers", "autodoc", "main.ts")],
		env: { ADOC_FIXTURES: join(root, "test", "fixtures", "autodoc", "http") },
		article: "n90954802",
		brand: "VAG",
		// originals без токена отвечает auth — токен фиктивный, сеть всё равно
		// подменена фикстурами.
		account: () => accountStore("autodoc").save({ access_token: "a.b.c", refresh_token: "r", expires_at: soon() }),
		authOffers: true,
	},
	{
		id: "armtek",
		bin: ["bun", join(root, "test", "fixtures", "armtek-cli.ts")],
		env: { ARMTEK_FIXTURES: JSON.stringify(armtekRoutes) },
		article: "0986452041",
		brand: "BOSCH",
		// Поиск armtek живёт на гостевом токене, а корзина — на пользовательском.
		account: () => accountStore("armtek").save({ access: "a.b.c", refresh: "r", expires: soon(), vkorg: "4000", vstel: "ME86" }),
		authOffers: false,
	},
]

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-contract-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

/** Окружение вызова: свой каталог конфига и фикстуры провайдера, ничего больше. */
const envOf = (c: Case): Record<string, string> => ({ ...c.env, [CONFIG_DIR_ENV]: dir, NO_COLOR: "1" })

const call = (c: Case, args: string[]) => invoke(c.bin, args, { env: envOf(c), id: c.id })

/** Провайдер как процесс: тут видно то, чего не видно из invoke, — код и stdout. */
async function spawnRaw(c: Case, args: string[]): Promise<{ code: number; out: string; err: string }> {
	const proc = Bun.spawn([...c.bin, ...args, "--json"], {
		env: { ...process.env, ...envOf(c) },
		stdin: "ignore", stdout: "pipe", stderr: "pipe",
	})
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
	return { code: await proc.exited, out, err }
}

const CAPABILITIES: Capability[] = ["reviews", "garage", "analogs", "basket", "orders"]

for (const c of cases) {
	describe(`контракт: ${c.id}`, () => {
		test("describe проходит валидацию агрегатора", async () => {
			const r = await call(c, ["describe"])
			expect(r.ok).toBe(true)
			if (!r.ok) return
			const d = parseDescribe(r.json, c.id)
			expect(d.contract).toBe(1)
			expect(d.commands.map(x => x.name)).toEqual(expect.arrayContaining(["login", "logout", "whoami", "search", "brands", "offers"]))
			// Валидатор молча выбрасывает незнакомые capability; сверяем с тем,
			// что провайдер написал сам, — иначе новая capability уехала бы в
			// молчание вместо разговора о версии контракта.
			const raw = (r.json as { capabilities: unknown[] }).capabilities
			expect(d.capabilities).toEqual(raw as Capability[])
			for (const cap of d.capabilities) expect(CAPABILITIES).toContain(cap)
			// Подкоманда именуется двумя словами через пробел — на это имя
			// агрегатор ориентируется в справке.
			if (d.capabilities.includes("basket")) expect(d.commands.map(x => x.name)).toContain("basket add")
		})

		test("в stdout ровно один JSON-объект, код 0", async () => {
			const r = await spawnRaw(c, ["describe"])
			expect(r.code).toBe(0)
			expect(r.out.trim().split("\n")).toHaveLength(1)
			expect(JSON.parse(r.out)).toMatchObject({ id: c.id, contract: 1 })
		})

		test("brands: форма контракта и тот же артикул", async () => {
			const r = await call(c, ["brands", c.article])
			expect(r.ok).toBe(true)
			if (!r.ok) return
			expect(r.warnings).toEqual([])
			const items = parseBrands(r.json, c.id)
			expect(items.length).toBeGreaterThan(0)
			expect(items.some(b => articleKey(b.article) === articleKey(c.article))).toBe(true)
			expect(items.some(b => b.brand === c.brand)).toBe(true)
		})

		test("offers: форма контракта, цена и ref для корзины", async () => {
			if (c.authOffers) await c.account()
			const r = await call(c, ["offers", c.article, "--brand", c.brand])
			expect(r.ok).toBe(true)
			if (!r.ok) return
			expect(r.warnings).toEqual([])
			const { items } = parseOffers(r.json, c.id)
			expect(items.length).toBeGreaterThan(0)
			for (const o of items) {
				expect(o.price).toBeGreaterThan(0)
				expect(o.currency).toBe("RUB")
				// Провайдер с capability basket обязан отдавать ref в каждом
				// предложении: без него `adoc basket add` нечем позвать.
				expect(o.ref).toBeDefined()
			}
			// Аналоги в выдаче законны и без --analogs (autodoc отдаёт
			// «рекомендованные партнёрами»), но точная строка обязана быть: по
			// ней агрегатор разделяет блоки «точные» и «аналоги».
			const exact = items.filter(o => !o.analog)
			expect(exact.length).toBeGreaterThan(0)
			for (const o of exact) {
				expect(articleKey(o.article)).toBe(articleKey(c.article))
				expect(o.brand).toBe(c.brand)
			}
		})

		test("whoami без аккаунта: ok:false и код 0, а не ошибка", async () => {
			const r = await call(c, ["whoami"])
			expect(r.ok).toBe(true)
			if (!r.ok) return
			// invoke считает ненулевой код без тела ошибки поломкой, так что
			// ok:true здесь заодно означает «вышел нулём».
			expect(parseWhoami(r.json, c.id)).toEqual({ ok: false })
		})

		test("basket: список позиций по форме контракта", async () => {
			await c.account()
			const r = await call(c, ["basket"])
			expect(r.ok).toBe(true)
			if (!r.ok) return
			const b = parseBasket(r.json, c.id)
			expect(b.currency).toBe("RUB")
			expect(b.items.length).toBeGreaterThan(0)
			for (const i of b.items) {
				expect(i.id).not.toBe("")
				expect(i.price).toBeGreaterThan(0)
				expect(i.quantity).toBeGreaterThan(0)
			}
		})

		test("неизвестная команда — bad_args, а не молчание", async () => {
			const r = await call(c, ["нетакой"])
			expect(r.ok).toBe(false)
			if (r.ok) return
			expect(r.error.code).toBe("bad_args")
		})
	})
}

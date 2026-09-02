// Фиктивный провайдер: без сети, всё в памяти и в паре файлов конфига.
// Один и тот же код играет разные роли — id и данные задаёт makeFake, а
// поведение крутится переменными окружения FAKE_<ID>_<КНОПКА>:
//   DELAY=<мс>     ответить с задержкой (проверка таймаута)
//   FAIL=<код>     любая контрактная команда падает этим кодом
//   FAIL_OFFERS=<код>  падает только offers, а brands отвечает как обычно
//   EMPTY_OFFERS=1 offers отвечает пустым списком, а brands — как обычно
//   AMBIGUOUS=1    brands возвращает ambiguous (exit 2) вместо списка
//   NOREVIEWS=1    в describe нет capability reviews (метод при этом есть)
//   NOBASKET=1     в describe нет capability basket (метод при этом есть)
//   NOGARAGE=1     в describe нет capability garage (метод при этом есть)
//   NOORDERS=1     в describe нет capability orders (метод при этом есть)

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ProviderError, articleKey, brandKey, configDir, defineProvider } from "../../../src/sdk/index.ts"
import type { Basket, Capability, ErrorCode, Offer, ProviderSpec } from "../../../src/sdk/index.ts"

export type FakeAccount = { token: string; user: string }
export type FakeData = { article: string; brand: string; price: number; seller: string }

const knob = (id: string, name: string): string | undefined => process.env[`FAKE_${id.toUpperCase()}_${name}`]

export function makeFake(id: string, data: FakeData): ProviderSpec<FakeAccount> {
	// `what` — имя команды: на нём проверяется случай «бренд нашёлся, а
	// предложения не отдались», в котором обёртка обязана не тронуть кэш.
	const gate = async (what?: string): Promise<void> => {
		const delay = knob(id, "DELAY")
		if (delay) await Bun.sleep(Number(delay))
		const fail = knob(id, "FAIL") ?? (what ? knob(id, `FAIL_${what}`) : undefined)
		if (fail) throw new ProviderError(fail as ErrorCode, `${id}: так велено переменной окружения`)
	}

	const auth = (a: FakeAccount | null): void => {
		if (!a) throw new ProviderError("auth", `${id}: нужен вход`)
	}

	// Корзина живёт в файле: каждый вызов — новый процесс, в памяти она
	// забывалась бы между `basket add` и `basket`.
	const basketFile = (): string => join(configDir(), `fake-${id}-basket.json`)
	const load = async (): Promise<Basket> => {
		try {
			return JSON.parse(await readFile(basketFile(), "utf8")) as Basket
		} catch {
			return { items: [], currency: "RUB", total: 0 }
		}
	}
	const store = async (b: Basket): Promise<Basket> => {
		const total = b.items.reduce((s, it) => s + it.price * it.quantity, 0)
		const full: Basket = { ...b, total, currency: "RUB" }
		await mkdir(configDir(), { recursive: true })
		await writeFile(basketFile(), JSON.stringify(full))
		return full
	}

	// Товарная база: два артикула. Второй — с двумя брендами, на нём
	// проверяется неоднозначность на уровне обёртки (у одного сайта два
	// производителя одного артикула), написанная у alpha и beta по-разному.
	type Row = { article: string; brand: string; name: string; price: number }
	const rows: Row[] = [
		{ article: data.article, brand: data.brand, name: "Болт", price: data.price },
		{ article: "MULTI-1", brand: data.brand, name: "Колодки", price: data.price + 100 },
		{ article: "MULTI 1", brand: "OTHER", name: "Колодки OTHER", price: data.price + 200 },
	]
	const find = (article: string): Row[] => rows.filter(r => articleKey(r.article) === articleKey(article))
	const toOffer = (r: Row, n: number): Offer => ({
		article: r.article, brand: r.brand, name: r.name, price: r.price, currency: "RUB",
		quantity: 3, deliveryDays: 2, seller: data.seller, rating: { average: 4.5, count: 10 },
		ref: { line: `${id}-${n}` },
	})

	const spec = defineProvider<FakeAccount, ["reviews", "garage", "analogs", "basket", "orders"]>({
		id, name: `Fake ${id}`, site: `https://${id}.example`,
		capabilities: ["reviews", "garage", "analogs", "basket", "orders"],

		login: async ctx => {
			const user = knob(id, "LOGIN") ?? await ctx.prompt("Логин > ")
			const password = knob(id, "PASSWORD") ?? await ctx.secret("Пароль > ")
			if (password !== "pw") throw new ProviderError("auth", "Логин или пароль не подошли")
			return { account: { token: `t-${user}`, user }, display: { name: user, email: `${user}@${id}.example` } }
		},
		// gate и здесь: на FAIL проверяется случай «вошли, а whoami не ответил».
		whoami: async ctx => {
			await gate()
			return ctx.account ? { name: ctx.account.user, email: `${ctx.account.user}@${id}.example` } : null
		},

		search: async (_ctx, text) => {
			await gate()
			if (text !== "болт") return { items: [] }
			return {
				items: [
					{ article: data.article, brand: data.brand, name: "Болт", price: data.price, quantity: 3, rating: { average: 4.5, count: 10 } },
					{ article: `${id.toUpperCase()}-ONLY`, brand: "OWN", name: `Своё у ${id}`, price: 100 },
				],
				total: 2,
			}
		},

		brands: async (_ctx, article) => {
			await gate()
			if (knob(id, "AMBIGUOUS")) throw new ProviderError("ambiguous", "уточни бренд", [{ brand: "AAA", article }, { brand: "BBB", article }])
			return { items: find(article).map(r => ({ brand: r.brand, article: r.article, name: r.name, rating: { average: 4.5, count: 10 } })) }
		},

		offers: async (_ctx, article, brand, { analogs }) => {
			await gate("OFFERS")
			// Бренд у сайта есть, а предложений по нему нет: обёртка обязана
			// обнулить кэш выдачи, а не оставить в нём прошлый артикул.
			if (knob(id, "EMPTY_OFFERS")) return { items: [] }
			const hit = find(article).filter(r => brandKey(r.brand) === brandKey(brand))
			const items = hit.map((r, i) => toOffer(r, i + 1))
			// Аналог — другой артикул: обёртка обязана унести его в отдельную таблицу.
			if (analogs && hit.length) items.push({ ...toOffer(hit[0]!, 9), article: "AN-1", brand: "ANALOG", price: data.price + 50, analog: true })
			return { items }
		},

		info: async (_ctx, article, brand) => {
			await gate()
			const hit = find(article).filter(r => brandKey(r.brand) === brandKey(brand))[0]
			if (!hit) throw new ProviderError("notfound", `${id}: ${article} (${brand}) не найден`)
			return { info: {
				article: hit.article, brand: hit.brand, name: hit.name, price: hit.price, currency: "RUB",
				deliveryDays: 2, rating: { average: 4.5, count: 10, histogram: [8, 1, 1, 0, 0] },
				url: `https://${id}.example/part/${hit.article}`,
				stock: [{ code: "S1", name: "склад", quantity: 3 }],
			} }
		},

		analogs: async (_ctx, article, brand) => {
			await gate()
			const hit = find(article).filter(r => brandKey(r.brand) === brandKey(brand))
			if (!hit.length) return { items: [] }
			return { items: [{ ...toOffer(hit[0]!, 9), article: "AN-1", brand: "ANALOG", price: data.price + 50, analog: true, analogOf: { article, brand } }] }
		},

		orders: async ctx => {
			auth(ctx.account)
			await gate()
			return { items: [{
				id: `${id}-1`, date: "2026-01-02", status: "выдан", total: data.price * 2, currency: "RUB",
				url: `https://${id}.example/orders/1`,
				items: [{ article: data.article, brand: data.brand, name: "Болт", qty: 2, price: data.price, sum: data.price * 2 }],
			}] }
		},

		reviews: async () => {
			await gate()
			return { total: 1, rating: { average: 4.5, count: 10, histogram: [8, 1, 1, 0, 0] }, items: [{ text: `отзыв у ${id}`, rating: 5, date: "2026-01-02" }] }
		},

		garageExport: async ctx => {
			auth(ctx.account)
			await gate()
			return { cars: [{ brand: "SKODA", model: "OCTAVIA III", modification: "1.8 TSI", year: 2017, vin: "TMBAG7NE0H0000001", ref: { carId: 1, source: id } }] }
		},

		basket: {
			list: async ctx => { auth(ctx.account); await gate(); return await load() },
			add: async (ctx, ref, qty) => {
				auth(ctx.account)
				await gate()
				const b = await load()
				const itemId = String(ref.line ?? "x")
				const items = b.items.some(i => i.id === itemId)
					? b.items.map(i => (i.id === itemId ? { ...i, quantity: i.quantity + qty } : i))
					: [...b.items, { id: itemId, article: data.article, brand: data.brand, name: "Болт", price: data.price, quantity: qty, deliveryDays: 2 }]
				return await store({ ...b, items })
			},
			set: async (ctx, itemId, qty) => {
				auth(ctx.account)
				const b = await load()
				return await store({ ...b, items: b.items.map(i => (i.id === itemId ? { ...i, quantity: qty } : i)) })
			},
			remove: async (ctx, itemId) => {
				auth(ctx.account)
				const b = await load()
				return await store({ ...b, items: b.items.filter(i => i.id !== itemId) })
			},
		},

		commands: {
			hello: { usage: "hello [имя]", about: "своя команда провайдера", auth: false, run: async (_ctx, args) => ({ json: { hello: args[0] ?? id }, render: () => `привет, ${args[0] ?? id}` }) },
		},
	})

	// Сайт без отзывов или без корзины: capability снимается уже с готовой
	// спеки, потому что defineProvider обязан видеть реализацию рядом с
	// объявлением. Обёртка смотрит только в describe — этого хватает, чтобы её
	// не спросили, и на этом проверяется отказ «не умеет <cap>».
	const off = new Set<Capability>()
	if (knob(id, "NOREVIEWS")) off.add("reviews")
	if (knob(id, "NOBASKET")) off.add("basket")
	if (knob(id, "NOGARAGE")) off.add("garage")
	if (knob(id, "NOORDERS")) off.add("orders")
	return off.size ? { ...spec, capabilities: spec.capabilities.filter(c => !off.has(c)) } : spec
}

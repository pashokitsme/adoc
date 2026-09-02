// Провайдер-заглушка: без сети, всё в памяти. Гоняется как отдельный процесс.
import { HttpError, ProviderError, defineProvider, runProvider } from "../../src/sdk/index.ts"
import type { Basket, Offer } from "../../src/sdk/contract.ts"

type Account = { token: string; user: string }

const offer: Offer = { article: "N1", brand: "VAG", name: "Болт", price: 407, currency: "RUB", quantity: 3, deliveryDays: 2, ref: { priceId: 7 } }
let basket: Basket = { items: [], currency: "RUB" }

export const fake = defineProvider<Account, ["reviews", "garage", "basket"]>({
	id: "fake", name: "Fake", site: "https://fake.example",
	capabilities: ["reviews", "garage", "basket"],
	valueFlags: ["echo"],

	// FAKE_LOGIN/FAKE_PASSWORD — вход без терминала: так живут провайдеры,
	// которые берут учётку из окружения (armtek), и так проверяется, что
	// tty требуется вопросу, а не команде login.
	login: async ctx => {
		const user = process.env.FAKE_LOGIN ?? await ctx.prompt("Логин > ")
		const password = process.env.FAKE_PASSWORD ?? await ctx.secret("Пароль > ")
		if (password !== "pw") throw new ProviderError("auth", "Логин или пароль не подошли")
		return { account: { token: "t-" + user, user }, display: { name: user } }
	},
	whoami: async ctx => (ctx.account ? { name: ctx.account.user } : null),
	search: async (_ctx, text) => ({ items: text === "болт" ? [{ article: "N1", brand: "VAG", name: "Болт", price: 407 }] : [], total: 1 }),
	brands: async (_ctx, article) => {
		if (article === "AMB") throw new ProviderError("ambiguous", "уточни бренд", [{ brand: "A", article }, { brand: "B", article }])
		return { items: article === "N1" ? [{ brand: "VAG", article, name: "Болт" }] : [] }
	},
	offers: async (ctx, article, brand, { analogs }) => {
		if (!ctx.account) throw new ProviderError("auth", "нужен вход")
		if (article !== "N1" || brand !== "VAG") return { items: [] }
		return { items: analogs ? [offer, { ...offer, article: "X2", analog: true }] : [offer] }
	},
	info: async (_ctx, article, brand) => ({ info: { article, brand, name: "Болт", price: 407, currency: "RUB", url: "https://fake.example/part/n1" } }),
	analogs: async (_ctx, article, brand) => ({ items: article === "N1" && brand === "VAG" ? [{ ...offer, article: "X2", analog: true }] : [] }),
	reviews: async () => ({ total: 1, items: [{ text: "ок", rating: 5 }] }),
	garageExport: async () => ({ cars: [{ brand: "SKODA", model: "OCTAVIA", ref: { carId: 1 } }] }),
	basket: {
		list: async () => basket,
		add: async (_ctx, ref, qty) => {
			basket = { ...basket, items: [...basket.items, { id: String(ref.priceId), article: "N1", brand: "VAG", price: 407, quantity: qty }] }
			return basket
		},
		set: async (_ctx, id, qty) => { basket = { ...basket, items: basket.items.map(i => (i.id === id ? { ...i, quantity: qty } : i)) }; return basket },
		remove: async (_ctx, id) => { basket = { ...basket, items: basket.items.filter(i => i.id !== id) }; return basket },
	},
	commands: {
		echo: { usage: "echo <текст> [--echo <x>]", about: "печатает аргументы", auth: false,
			run: async (ctx, args) => ({ json: { args, echo: ctx.flags.echo ?? null }, render: () => `echo: ${args.join(" ")}` }) },
		boom: { usage: "boom", about: "падает", auth: false, run: async () => { throw new Error("взрыв") } },
		http: { usage: "http", about: "падает ошибкой HTTP", auth: false, run: async () => { throw new HttpError(500, "http://x", "boom") } },
		// Заведомо больше буфера пайпа: ловит обрезание вывода на process.exit
		big: { usage: "big", about: "большой ответ", auth: false, run: async () => ({ json: { s: "x".repeat(200_000) } }) },
	},
})

if (import.meta.main) await runProvider(fake)

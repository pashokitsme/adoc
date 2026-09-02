// Фиктивный провайдер: без сети, всё в памяти и в паре файлов конфига.
// Один и тот же код играет разные роли — id и данные задаёт makeFake, а
// поведение крутится переменными окружения FAKE_<ID>_<КНОПКА>:
//   DELAY=<мс>     ответить с задержкой (проверка таймаута)
//   FAIL=<код>     любая контрактная команда падает этим кодом
//   FAIL_OFFERS=<код>  падает только offers, а brands отвечает как обычно
//   EMPTY_OFFERS=1 offers отвечает пустым списком, а brands — как обычно
//   KIT_OFFER=1    к предложениям добавляется тот же артикул и бренд, но
//                  комплектом и дешевле: `orders --prices` обязан заметить, что
//                  цена не про ту же деталь
//   SECOND_SELLER=1  то же предложение у второго продавца и дешевле: цена
//                  берётся у него, и он же назван в колонке «ОТКУДА»
//   ALIEN_OFFERS=1 в выдаче есть чужой артикул и чужой бренд дешевле своего:
//                  так ведёт себя сайт, подмешивающий «похожее», — сравнивать
//                  с уплаченным его нельзя
//   EMPTY_SEARCH=1 search отвечает пустым списком, не ошибкой
//   EMPTY_ANALOGS=1 analogs отвечает пустым списком: заменителей у сайта нет
//   AMBIGUOUS=1    brands возвращает ambiguous (exit 2) вместо списка
//   FAIL_INFO / FAIL_ANALOGS / FAIL_ORDERS=<код>  падает только эта команда
//   NOREVIEWS=1    в describe нет capability reviews (метод при этом есть)
//   NOBASKET=1     в describe нет capability basket (метод при этом есть)
//   NOGARAGE=1     в describe нет capability garage (метод при этом есть)
//   NOORDERS=1     в describe нет capability orders (метод при этом есть)
//   NOCAR=1        поиск игнорирует --car и предупреждает об этом
//   MORE=<n>       search говорит «нашлось n», отдавая свою обычную страницу:
//                  так ведёт себя сайт, у которого выдача не влезла в страницу
//   SAME_WARN=1    каждая команда пишет одну и ту же заметку в stderr: так
//                  ведёт себя armtek, когда сайт ограничил аккаунт, — `part`
//                  ловит её и на шаге брендов, и на шаге предложений

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ProviderError, articleKey, brandKey, configDir, defineProvider } from "../../../src/sdk/index.ts"
import type { Basket, Capability, ErrorCode, Offer, ProviderSpec } from "../../../src/sdk/index.ts"

export type FakeAccount = { token: string; user: string }
export type FakeData = { article: string; brand: string; price: number; seller: string }

const knob = (id: string, name: string): string | undefined => process.env[`FAKE_${id.toUpperCase()}_${name}`]

export function makeFake(id: string, data: FakeData): ProviderSpec<FakeAccount> {
	// Ссылки — половина смысла выдачи: обёртка обязана их показать, и фейк их
	// отдаёт везде, где контракт разрешает.
	const site = `https://${id}.example`
	const page = (article: string): string => `${site}/p/${encodeURIComponent(article)}`

	// `what` — имя команды: на нём проверяется случай «бренд нашёлся, а
	// предложения не отдались», в котором обёртка обязана не тронуть кэш.
	const gate = async (what?: string): Promise<void> => {
		const delay = knob(id, "DELAY")
		if (delay) await Bun.sleep(Number(delay))
		const fail = knob(id, "FAIL") ?? (what ? knob(id, `FAIL_${what}`) : undefined)
		if (fail) throw new ProviderError(fail as ErrorCode, `${id}: так велено переменной окружения`)
	}

	// Одна и та же заметка из разных команд: обёртка обязана напечатать её
	// один раз за запуск, а не по разу на каждый шаг.
	const note = (warn: (m: string) => void): void => {
		if (knob(id, "SAME_WARN")) warn(`${id}: заметка, одна на все шаги`)
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
		// Адрес корзины стоит во всех ответах, а не только в list: контракт
		// требует от add/set/rm вернуть корзину целиком, и заголовок блока после
		// изменения должен выглядеть так же, как после `adoc basket`.
		const full: Basket = { ...b, total, currency: "RUB", url: `${site}/basket` }
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
		// Сам не подходит машине, но его кросс CROSS-1 подходит: на нём
		// проверяется кросс-проверка применимости в обёртке.
		{ article: "NOFIT-1", brand: data.brand, name: "Пыльник", price: data.price + 300 },
		// Сайт про эту деталь применимости не знает вовсе.
		{ article: "UNSURE-1", brand: data.brand, name: "Отбойник", price: data.price + 400 },
		{ article: "CROSS-1", brand: "OEM", name: "Пыльник OEM", price: data.price + 350 },
	]
	const find = (article: string): Row[] => rows.filter(r => articleKey(r.article) === articleKey(article))
	const toOffer = (r: Row, n: number): Offer => ({
		article: r.article, brand: r.brand, name: r.name, price: r.price, currency: "RUB",
		quantity: 3, deliveryDays: 2, seller: data.seller, rating: { average: 4.5, count: 10 },
		url: page(r.article), ref: { line: `${id}-${n}` },
	})

	const spec = defineProvider<FakeAccount, ["reviews", "garage", "analogs", "basket", "orders", "fits", "crosses"]>({
		id, name: `Fake ${id}`, site,
		capabilities: ["reviews", "garage", "analogs", "basket", "orders", "fits", "crosses"],

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

		search: async (ctx, text, { car }) => {
			await gate()
			// Машина приезжает своим же ref-ом из `garage export`: обёртка не
			// придумывает его, а пересылает как есть. Сайт, который так не умеет,
			// говорит об этом вслух и ищет без машины.
			if (car && knob(id, "NOCAR")) ctx.warn(`${id}: поиск по машине не поддерживается`)
			const carId = car && !knob(id, "NOCAR") ? String(car.carId ?? car.linkingTargetId ?? "?") : undefined
			const more = Number(knob(id, "MORE")) || 0
			// Страница за концом выдачи: сайт отвечает пустым списком, но итог
			// свой называет — на нём и держится подсказка про --page.
			if (ctx.page > 1) return { items: [], ...(more ? { total: more } : {}) }
			if (text !== "болт" || knob(id, "EMPTY_SEARCH")) return { items: [] }
			return {
				items: [
					{ article: data.article, brand: data.brand, name: "Болт", price: data.price, quantity: 3, rating: { average: 4.5, count: 10 }, url: page(data.article) },
					{ article: `${id.toUpperCase()}-ONLY`, brand: "OWN", name: `Своё у ${id}`, price: 100, url: page(`${id.toUpperCase()}-ONLY`) },
					...(carId ? [{ article: `${id.toUpperCase()}-CAR`, brand: "OEM", name: `под машину ${carId}`, price: 50, url: page("car") }] : []),
				],
				total: more || (carId ? 3 : 2),
				// непрозрачная добавка сайта: обёртка обязана донести её до --json
				extra: { note: `${id} искал «${text}»`, ...(carId ? { car: carId } : {}) },
			}
		},

		brands: async (ctx, article) => {
			await gate()
			note(ctx.warn)
			if (knob(id, "AMBIGUOUS")) throw new ProviderError("ambiguous", "нужен бренд", [{ brand: "AAA", article }, { brand: "BBB", article }])
			return { items: find(article).map(r => ({ brand: r.brand, article: r.article, name: r.name, rating: { average: 4.5, count: 10 }, url: page(r.article) })) }
		},

		offers: async (ctx, article, brand, { analogs }) => {
			await gate("OFFERS")
			note(ctx.warn)
			// Бренд у сайта есть, а предложений по нему нет: обёртка обязана
			// обнулить кэш выдачи, а не оставить в нём прошлый артикул.
			if (knob(id, "EMPTY_OFFERS")) return { items: [] }
			const hit = find(article).filter(r => brandKey(r.brand) === brandKey(brand))
			const items = hit.map((r, i) => toOffer(r, i + 1))
			// Тот же номер, но продаётся комплектом: цена ниже, а товар другой.
			if (knob(id, "KIT_OFFER") && hit.length) {
				items.push({ ...toOffer(hit[0]!, 7), name: `${hit[0]!.name} компл. 10 шт`, price: data.price - 100, seller: "склад комплектов", ref: { line: `${id}-kit` } })
			}
			// Та же строка у другого продавца и дешевле.
			if (knob(id, "SECOND_SELLER") && hit.length) {
				items.push({ ...toOffer(hit[0]!, 8), price: data.price - 7, seller: "второй продавец", ref: { line: `${id}-2` } })
			}
			// Чужой товар в своей же выдаче: спрашивали не о нём.
			if (knob(id, "ALIEN_OFFERS") && hit.length) {
				items.push({ ...toOffer(hit[0]!, 6), article: "AN-1", brand: "ANALOG", price: data.price - 200, seller: "чужой склад", url: page("AN-1") })
			}
			// Аналог — другой артикул: обёртка обязана унести его в отдельную таблицу.
			if (analogs && hit.length) items.push({ ...toOffer(hit[0]!, 9), article: "AN-1", brand: "ANALOG", price: data.price + 50, analog: true, url: page("AN-1") })
			return { items }
		},

		info: async (_ctx, article, brand) => {
			await gate("INFO")
			const hit = find(article).filter(r => brandKey(r.brand) === brandKey(brand))[0]
			if (!hit) throw new ProviderError("notfound", `${id}: ${article} (${brand}) не найден`)
			return {
				info: {
					article: hit.article, brand: hit.brand, name: hit.name, price: hit.price, currency: "RUB",
					deliveryDays: 2, rating: { average: 4.5, count: 10, histogram: [8, 1, 1, 0, 0] },
					url: page(hit.article),
					stock: [{ code: "S1", name: "склад", quantity: 3 }],
					description: `Карточка ${hit.name} у ${id}`,
				},
				// Карточка отдаёт и цены — те же строки, что и offers: настоящий
				// провайдер берёт их оттуда же, и обёртке они приезжают так же.
				offers: [toOffer(hit, 1), { ...toOffer(hit, 2), price: hit.price + 30, seller: "второй продавец" }],
			}
		},

		// Кросс-ссылки: у фейка их две — замена и «в составе узла», причём
		// первая одна и та же у обоих сайтов: на ней проверяется склейка.
		crosses: async (_ctx, article, brand) => {
			await gate("CROSSES")
			if (knob(id, "EMPTY_CROSSES")) return { items: [] }
			// Кросс-ссылки считаются для пары «артикул + бренд»: у другого
			// бренда того же номера они свои, и путать их нельзя.
			if (brandKey(brand) === brandKey("OTHER")) {
				return { items: [{ article: "OTHER-CROSS", brand: "OTHER", kind: "aftermarket" as const, name: "замена OTHER", url: page("OTHER-CROSS") }] }
			}
			return { items: [
				{ article: "CROSS-1", brand: "OEM", kind: "aftermarket" as const, name: `замена ${article}`, url: page("CROSS-1") },
				{ article: `${id.toUpperCase()}-KIT`, brand, kind: "part-of" as const, name: "узел целиком", url: page(`${id.toUpperCase()}-KIT`) },
			] }
		},

		// Применимость: подходит всё, кроме артикулов на NOFIT-, а под ручкой
		// UNKNOWNFIT сайт честно не знает — три состояния контракта.
		fits: async (_ctx, article, brand, { car }) => {
			await gate("FITS")
			const target = car.carId ?? car.linkingTargetId ?? car.modificationId
			if (!target) return { fits: null, reason: `${id}: в ref машины нет идентификатора` }
			if (knob(id, "UNKNOWNFIT")) return { fits: null, reason: `${id}: нет данных о машине ${String(target)}`, url: page(article) }
			const key = article.toUpperCase()
			// «Не знаю» — такой же полноценный ответ, как да и нет: у сайта
			// бывает подбор-заглушка, в котором искать нечего.
			if (key.startsWith("UNSURE")) return { fits: null, reason: `${id}: подбор под машину ${String(target)} неполный`, url: page(article) }
			const ok = !key.startsWith("NOFIT")
			return { fits: ok, reason: `${id}: ${brand} ${ok ? "есть" : "нет"} в подборе машины ${String(target)}`, url: page(article) }
		},

		analogs: async (_ctx, article, brand) => {
			await gate("ANALOGS")
			const hit = find(article).filter(r => brandKey(r.brand) === brandKey(brand))
			if (!hit.length || knob(id, "EMPTY_ANALOGS")) return { items: [] }
			return { items: [{ ...toOffer(hit[0]!, 9), article: "AN-1", brand: "ANALOG", price: data.price + 50, analog: true, analogOf: { article, brand }, url: page("AN-1") }] }
		},

		orders: async ctx => {
			auth(ctx.account)
			await gate("ORDERS")
			return { items: [{
				id: `${id}-1`, date: "2026-01-02", status: "выдан", total: data.price * 2, currency: "RUB",
				url: `${site}/orders/1`,
				items: [{ article: data.article, brand: data.brand, name: "Болт", qty: 2, price: data.price, sum: data.price * 2, url: page(data.article) }],
			}] }
		},

		reviews: async (_ctx, article) => {
			await gate()
			return {
				total: 1, rating: { average: 4.5, count: 10, histogram: [8, 1, 1, 0, 0] },
				url: `${site}/r/${encodeURIComponent(article)}`,
				items: [{ text: `отзыв у ${id}`, rating: 5, date: "2026-01-02", url: `${site}/r/${encodeURIComponent(article)}#1` }],
			}
		},

		garageExport: async ctx => {
			auth(ctx.account)
			await gate()
			return { cars: [{ brand: "SKODA", model: "OCTAVIA III", modification: "1.8 TSI", year: 2017, vin: "TMBAG7NE0H0000001", ref: { carId: 1, source: id } }] }
		},

		basket: {
			list: async ctx => { auth(ctx.account); await gate(); return { ...(await load()), url: `${site}/basket` } },
			add: async (ctx, ref, qty) => {
				auth(ctx.account)
				await gate()
				const b = await load()
				const itemId = String(ref.line ?? "x")
				const items = b.items.some(i => i.id === itemId)
					? b.items.map(i => (i.id === itemId ? { ...i, quantity: i.quantity + qty } : i))
					: [...b.items, { id: itemId, article: data.article, brand: data.brand, name: "Болт", price: data.price, quantity: qty, deliveryDays: 2, url: page(data.article) }]
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

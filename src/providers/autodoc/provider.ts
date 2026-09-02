// provider.ts — autodoc.ru как провайдер контракта. Вся сайтоспецифика — в
// api.ts/auth.ts/map.ts; здесь только склейка вызовов и свои команды.

import { ProviderError, defineProvider, positiveInt, type Display, type Offer } from "../../sdk/index.ts"
import * as api from "./api.ts"
import { ApiError } from "./api.ts"
import * as auth from "./auth.ts"
import type { Tokens } from "./auth.ts"
import { resolveBrand } from "./brand.ts"
import type { Brand } from "./brand.ts"
import { commands } from "./commands.ts"
import {
	SITE, basketAddBody, bestCategory, carQuery, categoryIds, reviewsUrl, toBasket, toBrandHits, toCars,
	toInfo, toOffers, toOrders, toProducts, toReviews, type AutodocRef,
} from "./map.ts"

function display(t: Tokens): Display {
	const c = auth.decodeClaims(t.access_token)
	return {
		name: c?.unique_name || c?.login || c?.preferred_username || "аккаунт без имени",
		// Сайт маскирует displayEmail и phone_number сам; сырой email лежит в claim `email`.
		// Телефон без звёздочек autodoc не отдаёт ни в токене, ни в профиле — показываем как есть.
		email: c?.email || c?.displayEmail,
		phone: c?.phone_number,
	}
}

// pickBrand по числовому id, которого нет в выдаче, отдаёт имя пустым. Пустое
// имя нельзя пускать в toOffers: там оно ключ склейки «оригинал или аналог».
const brandLabel = (b: Brand, given: string): string => b.name || given

/** Числовой флаг: тот же разбор, что у контрактных --page/--limit в run.ts. */
const numFlag = (name: string, v: string | true | undefined): number | undefined =>
	v === undefined ? undefined : positiveInt(`--${name}`, v)

// «Аналогов нет» — это 404 и только он. Отозванный токен, 5xx или обрыв сети
// должны валить команду: молча отдать оригиналы без аналогов значит соврать
// агрегатору, что аналогов у детали не бывает.
/** Один текст на все ручки: агрегатору важно, что молчит именно сайт. */
const timeoutError = () => new ProviderError("timeout", `нет ответа от web.autodoc.ru за ${Math.round(api.TIMEOUT_MS / 1000)} с`)

const noAnalogs = (e: unknown): null => {
	if (e instanceof ApiError && e.status === 404) return null
	throw e
}

/**
 * Предложения по паре (артикул, бренд) — один источник на `offers --analogs` и
 * на `analogs`, чтобы они не могли разойтись. Так уже было: `analogs` спрашивал
 * только `price-list/analogs`, а тот отдаёт кросс-таблицу замен без строк
 * прайса (`items` пустой у всех 217 позиций) — команда возвращала пустоту, хотя
 * `offers --analogs` находил 21 аналог. Аналоги у autodoc приходят **группами
 * внутри originals** («Рекомендованные аналоги на складе Автодок» и подобными);
 * `price-list/analogs` спрашиваем всё равно — на случай, если там появятся
 * настоящие предложения.
 */
async function offerRows(article: string, b: Brand, name: string, withAnalogs: boolean): Promise<Offer[]> {
	const [orig, an] = await Promise.all([
		api.offers(article, b.id),
		withAnalogs ? api.analogs(article, b.id).catch(noAnalogs) : Promise.resolve(null),
	])
	const items = toOffers(orig, article, name)
	if (an) items.push(...toOffers(an, article, name, true))
	return items
}

export const autodoc = defineProvider<Tokens, ["reviews", "garage", "analogs", "basket", "orders"]>({
	id: "autodoc", name: "Autodoc", site: SITE,
	capabilities: ["reviews", "garage", "analogs", "basket", "orders"],
	valueFlags: ["sort"],
	mapError: e => {
		if (e instanceof ApiError) return new ProviderError(e.status === 401 ? "auth" : e.status === 404 ? "notfound" : "http", e.message)
		if (api.isTimeout(e)) return timeoutError()
		return null
	},

	login: async ctx => {
		if (ctx.flags.paste === true) {
			ctx.warn("Вход по сохранённой сессии браузера:\n  1. Войти на https://www.autodoc.ru\n  2. DevTools → Console → copy(JSON.stringify(sessionStorage))\n  3. Вставить буфер сюда")
			for (let attempt = 1; attempt <= 3; attempt++) {
				// дамп sessionStorage — это токены целиком, эхо в терминал им не нужно
				const parsed = auth.parsePasted(await ctx.secret("  > "))
				if (parsed && "tokens" in parsed) return { account: parsed.tokens, display: display(parsed.tokens) }
				ctx.warn(parsed ? "  это диагностика ошибки SPA, а не токены" : "  здесь нет access_token — нужен дамп sessionStorage")
			}
			throw new ProviderError("bad_args", "три неудачные попытки")
		}
		const username = (await ctx.prompt("Логин, телефон или email > ")).trim()
		if (!username) throw new ProviderError("bad_args", "Логин не может быть пустым")
		const password = await ctx.secret("Пароль > ")
		if (!password) throw new ProviderError("bad_args", "Пароль не может быть пустым")
		let tokens: Tokens
		try {
			tokens = await auth.passwordGrant(username, password)
		} catch (e) {
			// Молчание сервера токенов — это таймаут, а не «пароль не подошёл»:
			// иначе совет пользователю был бы противоположный нужному.
			if (api.isTimeout(e)) throw timeoutError()
			const m = e instanceof Error ? e.message : String(e)
			throw new ProviderError("auth", m.includes("invalid_grant") ? "Логин или пароль не подошли" : m)
		}
		if (!tokens.refresh_token) ctx.warn("refresh-токена нет — вход придётся повторить, когда access протухнет")
		return { account: tokens, display: display(tokens) }
	},

	// Файл аккаунта — ещё не рабочий вход: access мог протухнуть. currentToken
	// молча обновит, когда может (в фикстурном режиме сети нет — протухший
	// считается негодным сразу); вернул null — показывать нечего. Сам файл
	// whoami не трогает: удалять аккаунт — дело logout.
	whoami: async ctx => {
		if (!ctx.account) return null
		const access = await auth.currentToken()
		return access ? display({ ...ctx.account, access_token: access }) : null
	},

	// Поиск повторяет путь сайта: подсказка выбирает категорию, товары внутри
	// категории отдаёт find-goods. Машина — те же три параметра, что шлёт сама
	// страница категории; PageNumber у неё нумеруется с нуля.
	search: async (ctx, text, { car }) => {
		const s = await api.suggest(text)
		const cats = categoryIds(s.items ?? [])
		if (!cats.length) return { items: [], total: 0, extra: { categories: [] } }
		const best = bestCategory(cats, text)
		const q = carQuery(car)
		if (car && !q) ctx.warn("autodoc: в ref машины нет brandName/modelId/modificationId — ищу без машины")
		const r = await api.categoryGoods(best.id, {
			PageNumber: ctx.page - 1, MaxResultCount: ctx.limit,
			SortingId: numFlag("sort", ctx.flags.sort), ...q,
		})
		return {
			items: toProducts(r.items ?? [], r.categoryName ?? best.title),
			total: r.totalCount,
			extra: { categories: cats, category: { id: best.id, title: r.categoryName ?? best.title }, car: q ?? null },
		}
	},

	brands: async (_ctx, article) => {
		const { items } = await api.searchArticle(article)
		const infos = new Map(await Promise.all((items ?? []).map(async h =>
			[h.manufacturer.id, await api.goodsInfo(h.article, h.manufacturer.id).catch(() => null)] as const)))
		return { items: toBrandHits(items ?? [], infos) }
	},

	offers: async (_ctx, article, brand, { analogs }) => {
		const b = await resolveBrand(article, brand)
		const items = await offerRows(article, b, brandLabel(b, brand), analogs)
		// сайт отдаёт выдачу целиком, страниц у неё нет — итог и есть длина
		return { items, total: items.length }
	},

	// Карточка вместе с предложениями: строки те же, что у `offers` без
	// аналогов, и берутся они тем же offerRows — второго правила «что считать
	// предложением» в провайдере нет.
	info: async (_ctx, article, brand) => {
		const b = await resolveBrand(article, brand)
		const [inf, price, offers] = await Promise.all([
			api.goodsInfo(article, b.id),
			api.goodsPrice(article, b.id).catch(() => null),
			offerRows(article, b, brandLabel(b, brand), false).catch(() => [] as Offer[]),
		])
		// по цене: карточка отвечает на «сколько стоит», и первым читается дешёвое
		return { info: toInfo(inf, price), offers: offers.sort((a, b) => a.price - b.price) }
	},

	// Только аналоги: ровно те строки `offers --analogs`, у которых analog:true.
	// Точные совпадения живут в offers, и дублировать их здесь значит заставить
	// агрегатора отличать одно от другого руками.
	analogs: async (_ctx, article, brand) => {
		const b = await resolveBrand(article, brand)
		const items = (await offerRows(article, b, brandLabel(b, brand), true)).filter(o => o.analog)
		return { items, total: items.length }
	},

	reviews: async (ctx, article, brand) => {
		const b = await resolveBrand(article, brand)
		const [r, info] = await Promise.all([
			api.reviews(article, b.id, { PageNumber: ctx.page, MaxResultCount: ctx.limit }),
			api.goodsInfo(article, b.id).catch(() => null),
		])
		return toReviews(r, info, reviewsUrl(b.id, info?.article ?? article))
	},

	orders: async () => ({ items: toOrders((await api.orders()).items ?? []) }),

	garageExport: async () => {
		const [list, top] = await Promise.all([api.garageCars(), api.garageTopCar().catch(() => null)])
		return { cars: toCars(list.cars ?? [], top?.car?.id ?? null) }
	},

	basket: {
		list: async () => toBasket(await api.basket()),
		add: async (_ctx, ref, qty) => {
			const r = ref as unknown as AutodocRef
			if (typeof r.priceId !== "number" || !r.article) throw new ProviderError("bad_args", "ref не похож на предложение autodoc")
			await api.basketAdd(basketAddBody(r, Math.max(qty, r.minimalQuantity ?? 1)))
			return toBasket(await api.basket())
		},
		set: async (_ctx, itemId, qty) => {
			const cur = toBasket(await api.basket())
			const it = cur.items.find(i => i.id === itemId)
			if (!it) throw new ProviderError("notfound", `в корзине нет позиции ${itemId}`)
			await api.basketUpdate({ id: itemId, quantity: qty, priceType: it.extra?.priceType as number | undefined, hash: it.extra?.hash as string | undefined })
			return toBasket(await api.basket())
		},
		remove: async (_ctx, itemId) => {
			const cur = toBasket(await api.basket())
			const it = cur.items.find(i => i.id === itemId)
			if (!it) throw new ProviderError("notfound", `в корзине нет позиции ${itemId}`)
			await api.basketDelete({ items: [{ id: itemId, priceType: it.extra?.priceType as number | undefined, hash: it.extra?.hash as string | undefined }], deleteAll: false })
			return toBasket(await api.basket())
		},
	},

	commands,
})

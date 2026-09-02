// provider.ts — armtek.ru как провайдер контракта. Сайтоспецифика живёт в
// api.ts (запросы), auth.ts (токены), map.ts (перевод в типы контракта) и
// brand.ts (выбор бренда); здесь только склейка.

import { ProviderError, articleKey, brandKey, defineProvider, type Offer } from "../../sdk/index.ts"
import type { Ctx } from "../../sdk/define.ts"
import * as api from "./api.ts"
import { mapHttpError } from "./api.ts"
import { accessToken, decodeClaims, login, publicRead, whoami, type Account } from "./auth.ts"
import * as brand from "./brand.ts"
import { commands } from "./commands.ts"
import {
	bestCategory, carTarget, categoryQueries, isRef, productUrl, refOfCartItem, toBasket, toBrandHits, toCars, toInfo,
	toOffers, toOrders, toProducts, toReviews, writeItem, type ArmtekRef,
} from "./map.ts"

/**
 * Сколько страниц категории пролистать, проверяя применимость. Три — это ~108
 * позиций: дальше вопрос стоит дороже ответа, а темп сайт считает по аккаунту.
 */
const FIT_PAGES = 3

/** Точка выдачи и организация аккаунта; без входа — умолчания фронта. */
const place = (ctx: Ctx<Account>): brand.Place => ({
	vkorg: ctx.account?.vkorg ?? api.DEFAULT_VKORG,
	vstel: ctx.account?.vstel ?? api.DEFAULT_VSTEL,
})

/** Сырая корзина плюс токен: три из четырёх операций начинаются одинаково. */
async function cart(ctx: Ctx<Account>): Promise<{ token: string; vkorg: string; vstel: string; raw: api.RawCart }> {
	const token = await accessToken(ctx)
	const p = place(ctx)
	const a = ctx.account
	const raw = await api.cartState(token, { ...p, category: a?.category, segment: a?.segment })
	return { token, ...p, raw }
}

export const armtek = defineProvider<Account, ["reviews", "garage", "analogs", "basket", "orders", "fits"]>({
	id: "armtek",
	name: "Armtek",
	site: "https://armtek.ru",
	capabilities: ["reviews", "garage", "analogs", "basket", "orders", "fits"],
	valueFlags: ["body"],
	mapError: mapHttpError,

	login,
	whoami,

	/**
	 * Поиск по названию идёт тем же путём, что и подсказка сайта: категория из
	 * autocomplete, а потом `search/by-category`. Свободный поиск `v1/search`
	 * — это то, что сайт делает по Enter, и его выдача склеивается по бренду:
	 * на «фильтр масляный» первые восемь строк — грузовые фильтры STELLOX, а
	 * девятая и десятая уже уплотнительные кольца. Категория даёт то, что
	 * человек ожидает увидеть, и заодно единственная умеет фильтр по машине
	 * (`linkingTargetId`), которую `v1/search` отбивает четырёхсотым.
	 *
	 * Категории под запрос нет — падаем в свободный поиск: он находит там, где
	 * категории не существует (артикул, бренд, редкое слово). Категория
	 * считается найденной, только если хоть одно слово её названия есть в
	 * запросе: на артикул подсказка тоже отвечает какой-нибудь категорией.
	 */
	search: async (ctx, text, { car }) => await publicRead(ctx, async token => {
		const p = place(ctx)
		const target = carTarget(car)
		if (car && !target) ctx.warn("armtek: в ref машины нет идентификатора модификации TecDoc — ищу без машины")

		const suggest = await api.autocomplete(text, token).catch(() => null)
		const cat = bestCategory(suggest?.category ?? [], text)
		if (cat) {
			const r = await api.searchByCategory({ categoryAlias: cat.ALIAS, page: ctx.page, ...p, ...target }, token)
			return {
				items: toProducts(r.articlesData ?? []).slice(0, ctx.limit),
				total: r.pagination?.totalCount,
				extra: {
					page: r.pagination?.currentPage, perPage: r.pagination?.perPage, pageCount: r.pagination?.pageCount,
					category: { id: cat.ID, alias: cat.ALIAS, name: cat.NAME }, car: target ?? null,
				},
			}
		}
		if (target) ctx.warn(`armtek: под «${text}» категории не нашлось — ищу без машины`)

		const r = await api.search({ query: text, queryType: 1, page: ctx.page, typeView: "list", ...p }, token)
		return {
			items: toProducts(r.articlesData ?? []).slice(0, ctx.limit),
			total: r.pagination?.totalCount,
			extra: { page: r.pagination?.currentPage, perPage: r.pagination?.perPage, pageCount: r.pagination?.pageCount },
		}
	}),

	brands: async (ctx, article) => await publicRead(ctx, async token => ({
		items: toBrandHits(await brand.exactSearch(article, token, place(ctx), ctx.warn)),
	})),

	offers: async (ctx, article, brandName, { analogs }) => await publicRead(ctx, async token => {
		const p = place(ctx)
		const { row } = await brand.resolve(article, brandName, token, p, ctx.warn)
		const want = { article, brand: row.BRAND }
		if (!analogs) return { items: toOffers([row], want, p.vstel) }

		// queryType 1 отдаёт точные строки вместе с аналогами, но страницами по
		// 36: на дальних страницах точной строки уже нет, и без этой проверки
		// `--analogs` терял бы оригинал.
		const all = await api.search({ query: article, queryType: 1, page: ctx.page, typeView: "list", ...p }, token)
		const rows = all.articlesData ?? []
		// Аналоги приходят страницами, а --page у offers контрактом не
		// предусмотрен: агрегатор получит одну страницу и не сможет узнать об
		// этом из ответа. Значит, говорим вслух — в stderr, чтобы --json
		// остался ровно одним объектом.
		const pageCount = all.pagination?.pageCount ?? 1
		if (pageCount > 1) {
			ctx.warn(`armtek: аналогов ${all.pagination?.totalCount ?? "?"} на ${pageCount} страницах, возвращена только страница ${all.pagination?.currentPage ?? ctx.page} из ${pageCount}`)
		}
		const hasExact = rows.some(a => articleKey(a.PIN) === articleKey(article) && brandKey(a.BRAND) === brandKey(row.BRAND))
		// сколько предложений насчитал сайт — чтобы агрегатор не выдавал одну
		// страницу за всю выдачу; строк в items меньше на весь хвост страниц
		return { items: toOffers(hasExact ? rows : [row, ...rows], want, p.vstel), total: all.pagination?.totalCount }
	}),

	/**
	 * Карточка. Форма `card` сливает предложение с артикулом, поэтому склады,
	 * цены и сроки видно одним списком — это и есть наличие в `Info.stock`.
	 */
	info: async (ctx, article, brandName) => await publicRead(ctx, async token => {
		const p = place(ctx)
		const r = await api.search({ query: article, queryType: 2, typeView: "card", ...p }, token)
		const wantArticle = articleKey(article)
		const wantBrand = brandKey(brandName)
		const rows = (r.articlesData ?? []).filter(c => articleKey(c.PIN) === wantArticle && brandKey(c.BRAND) === wantBrand)
		if (!rows.length) throw new ProviderError("notfound", `armtek: ${article} (${brandName}) — ничего не найдено`)
		const stats = await api.reviewRating(rows[0]!.ARTID, token).catch(() => [] as api.RawReviewRating[])
		// Предложения к карточке — те же строки, что отдаёт `offers`: карточка
		// без них отвечает на «сколько стоит» одним числом «от». Отдельный
		// запрос: карточный вид (typeView card) цену по точкам выдачи не даёт.
		const offers = await brand.resolve(article, brandName, token, p, ctx.warn)
			.then(({ row }) => toOffers([row], { article, brand: row.BRAND }, p.vstel))
			.catch(() => [] as Offer[])
		return { info: toInfo(rows, stats[0]), offers: offers.sort((a, b) => a.price - b.price) }
	}),

	/**
	 * Применимость. Прямого ответа у сайта нет, но `search/by-category` —
	 * единственная его ручка с фильтром по машине (`linkingTargetId`), и
	 * вопрос сводится к «есть ли артикул в своей категории под эту машину».
	 *
	 * Категорию берём по названию детали через ту же подсказку, что и поиск:
	 * своего поля категории в строке артикула у armtek нет. Не нашлась —
	 * отвечаем «не знаю»: выдумывать «не подходит» нельзя.
	 */
	fits: async (ctx, article, brandName, { car }) => await publicRead(ctx, async token => {
		const p = place(ctx)
		const target = carTarget(car)
		const { row } = await brand.resolve(article, brandName, token, p, ctx.warn)
		const url = productUrl(row.ARTICLE_ALIAS, row.ARTID)
		if (!target) return { fits: null, reason: "в ref машины нет идентификатора модификации TecDoc", url }
		// Подсказка не понимает длинное имя целиком, поэтому пробуем его же
		// короче: лишний запрос уходит только когда предыдущий ничего не нашёл.
		let cat: api.SuggestCategory | undefined
		for (const q of categoryQueries(row.NAME ?? "")) {
			const suggest = await api.autocomplete(q, token).catch(() => null)
			cat = bestCategory(suggest?.category ?? [], q)
			if (cat) break
		}
		if (!cat) return { fits: null, reason: "категория детали не нашлась — применимость не проверить", url }
		const want = articleKey(article)
		const wantBrand = brandKey(row.BRAND)
		// Категория отдаётся страницами по 36. Листаем не больше FIT_PAGES: сайт
		// считает темп по аккаунту, и «не знаю» дешевле, чем 429 на весь запуск.
		let seen = 0
		let pageCount = 1
		let total: number | undefined
		for (let page = 1; page <= FIT_PAGES; page++) {
			const r = await api.searchByCategory({ categoryAlias: cat.ALIAS, page, ...p, ...target }, token)
			const rows = r.articlesData ?? []
			seen += rows.length
			pageCount = r.pagination?.pageCount ?? 1
			total = r.pagination?.totalCount
			if (rows.some(a => articleKey(a.PIN) === want && brandKey(a.BRAND) === wantBrand)) {
				return { fits: true, reason: `есть в «${cat.NAME}» под эту машину`, url }
			}
			if (page >= pageCount) break
		}
		// Просмотрели не всё — это «не знаю», а не «не подходит».
		if (pageCount > FIT_PAGES) {
			return { fits: null, reason: `в «${cat.NAME}» под эту машину ${total ?? "?"} позиций на ${pageCount} страницах, просмотрены первые ${FIT_PAGES}`, url }
		}
		return { fits: false, reason: `нет в «${cat.NAME}» под эту машину (${total ?? seen} позиций)`, url }
	}),

	// Только аналоги: точные строки отдаёт offers, и повторять их здесь значит
	// заставить агрегатора отличать одно от другого руками.
	analogs: async (ctx, article, brandName) => await publicRead(ctx, async token => {
		const p = place(ctx)
		const { row } = await brand.resolve(article, brandName, token, p, ctx.warn)
		const all = await api.search({ query: article, queryType: 1, page: ctx.page, typeView: "list", ...p }, token)
		const pageCount = all.pagination?.pageCount ?? 1
		if (pageCount > 1) {
			ctx.warn(`armtek: аналогов ${all.pagination?.totalCount ?? "?"} на ${pageCount} страницах, возвращена только страница ${all.pagination?.currentPage ?? ctx.page} из ${pageCount}`)
		}
		const rows = (all.articlesData ?? []).filter(a =>
			articleKey(a.PIN) !== articleKey(article) || brandKey(a.BRAND) !== brandKey(row.BRAND))
		return { items: toOffers(rows, { article, brand: row.BRAND }, p.vstel), total: all.pagination?.totalCount }
	}),

	reviews: async (ctx, article, brandName) => await publicRead(ctx, async token => {
		const { row } = await brand.resolve(article, brandName, token, place(ctx), ctx.warn)
		const [list, stats] = await Promise.all([
			api.reviewsByArtId(row.ARTID, token, { page: ctx.page, limit: ctx.limit }),
			// оценки — отдельная ручка; без неё лента всё ещё имеет смысл
			api.reviewRating(row.ARTID, token).catch(() => [] as api.RawReviewRating[]),
		])
		return toReviews(list, stats[0], productUrl(row.ARTICLE_ALIAS, row.ARTID))
	}),

	orders: async ctx => {
		const token = await accessToken(ctx)
		const r = await api.orderReport(token, place(ctx).vkorg, ctx.page)
		return { items: toOrders(r.ORDER) }
	},

	garageExport: async ctx => {
		const token = await accessToken(ctx)
		const clientId = ctx.account?.clientId ?? decodeClaims(token)?.data?.clientId
		if (!clientId) throw new ProviderError("auth", "в токене нет clientId — нужен повторный вход: adoc login armtek")
		const g = await api.garageList(token, clientId, place(ctx).vkorg)
		return { cars: toCars(g.transportList) }
	},

	basket: {
		list: async ctx => {
			const c = await cart(ctx)
			return toBasket(c.raw, c.vstel)
		},

		add: async (ctx, ref, qty) => {
			if (!isRef(ref)) throw new ProviderError("bad_args", "--ref не похож на предложение armtek: нужен ref из выдачи offers")
			const c = await cart(ctx)
			await api.cartAdd(c.token, c.vkorg, [writeItem(ref as ArmtekRef, qty)])
			return toBasket(await api.cartState(c.token, { vkorg: c.vkorg, vstel: c.vstel, category: ctx.account?.category, segment: ctx.account?.segment }), c.vstel)
		},

		// POST по существующему posnr сайт отбивает четырёхсотым, поэтому смена
		// количества — только PUT, и тело для него собирается из того, что уже
		// лежит в корзине: цену и склад менять нельзя.
		set: async (ctx, itemId, qty) => {
			const c = await cart(ctx)
			const posnr = Number(itemId)
			const item = c.raw.items?.find(i => i.posnr === posnr)
			if (!item) throw new ProviderError("notfound", `в корзине нет позиции ${itemId}`)
			await api.cartUpdate(c.token, c.vkorg, [writeItem(refOfCartItem(item, c.vstel), qty, posnr)])
			return toBasket(await api.cartState(c.token, { vkorg: c.vkorg, vstel: c.vstel, category: ctx.account?.category, segment: ctx.account?.segment }), c.vstel)
		},

		remove: async (ctx, itemId) => {
			const c = await cart(ctx)
			const posnr = Number(itemId)
			if (!c.raw.items?.some(i => i.posnr === posnr)) throw new ProviderError("notfound", `в корзине нет позиции ${itemId}`)
			await api.cartDelete(c.token, c.vkorg, [posnr])
			return toBasket(await api.cartState(c.token, { vkorg: c.vkorg, vstel: c.vstel, category: ctx.account?.category, segment: ctx.account?.segment }), c.vstel)
		},
	},

	commands,
})

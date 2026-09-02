// provider.ts — autodoc.ru как провайдер контракта. Вся сайтоспецифика — в
// api.ts/auth.ts/map.ts; здесь только склейка вызовов и свои команды.

import { ProviderError, defineProvider, type Display } from "../../sdk/index.ts"
import * as api from "./api.ts"
import { ApiError } from "./api.ts"
import * as auth from "./auth.ts"
import type { Tokens } from "./auth.ts"
import { resolveBrand } from "./brand.ts"
import type { Brand } from "./brand.ts"
import { commands } from "./commands.ts"
import { basketAddBody, categoryIds, toBasket, toBrandHits, toCars, toOffers, toProducts, toReviews, type AutodocRef } from "./map.ts"

function display(t: Tokens): Display {
	const c = auth.decodeClaims(t.access_token)
	return {
		name: c?.unique_name || c?.login || c?.preferred_username || "аккаунт без имени",
		email: c?.displayEmail || c?.email,
		phone: c?.phone_number,
	}
}

// pickBrand по числовому id, которого нет в выдаче, отдаёт имя пустым. Пустое
// имя нельзя пускать в toOffers: там оно ключ склейки «оригинал или аналог».
const brandLabel = (b: Brand, given: string): string => b.name || given

// «Аналогов нет» — это 404 и только он. Отозванный токен, 5xx или обрыв сети
// должны валить команду: молча отдать оригиналы без аналогов значит соврать
// агрегатору, что аналогов у детали не бывает.
/** Один текст на все ручки: агрегатору важно, что молчит именно сайт. */
const timeoutError = () => new ProviderError("timeout", `нет ответа от web.autodoc.ru за ${Math.round(api.TIMEOUT_MS / 1000)} с`)

const noAnalogs = (e: unknown): null => {
	if (e instanceof ApiError && e.status === 404) return null
	throw e
}

export const autodoc = defineProvider<Tokens, ["reviews", "garage", "analogs", "basket"]>({
	id: "autodoc", name: "Autodoc", site: "https://www.autodoc.ru",
	capabilities: ["reviews", "garage", "analogs", "basket"],
	valueFlags: ["sort"],
	mapError: e => {
		if (e instanceof ApiError) return new ProviderError(e.status === 401 ? "auth" : e.status === 404 ? "notfound" : "http", e.message)
		if (api.isTimeout(e)) return timeoutError()
		return null
	},

	login: async ctx => {
		if (ctx.flags.paste === true) {
			ctx.warn("Вход по сохранённой сессии браузера:\n  1. Войди на https://www.autodoc.ru\n  2. DevTools → Console → copy(JSON.stringify(sessionStorage))\n  3. Вставь буфер сюда")
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

	search: async (ctx, text) => {
		const s = await api.suggest(text)
		const cats = categoryIds(s.items ?? [])
		if (!cats.length) return { items: [], total: 0, extra: { categories: [] } }
		const first = cats[0]!
		const r = await api.categoryGoods(first.id, { PageNumber: ctx.page })
		return { items: toProducts(r.items ?? [], first.title).slice(0, ctx.limit), total: r.totalCount, extra: { categories: cats } }
	},

	brands: async (_ctx, article) => {
		const { items } = await api.searchArticle(article)
		const infos = new Map(await Promise.all((items ?? []).map(async h =>
			[h.manufacturer.id, await api.goodsInfo(h.article, h.manufacturer.id).catch(() => null)] as const)))
		return { items: toBrandHits(items ?? [], infos) }
	},

	offers: async (_ctx, article, brand, { analogs }) => {
		const b = await resolveBrand(article, brand)
		const name = brandLabel(b, brand)
		const [orig, an] = await Promise.all([
			api.offers(article, b.id),
			analogs ? api.analogs(article, b.id).catch(noAnalogs) : Promise.resolve(null),
		])
		const items = toOffers(orig, article, name)
		if (an) items.push(...toOffers(an, article, name, true))
		return { items }
	},

	reviews: async (ctx, article, brand) => {
		const b = await resolveBrand(article, brand)
		const [r, info] = await Promise.all([
			api.reviews(article, b.id, { PageNumber: ctx.page, MaxResultCount: ctx.limit }),
			api.goodsInfo(article, b.id).catch(() => null),
		])
		return toReviews(r, info)
	},

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

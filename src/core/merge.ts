// merge.ts — склейка выдачи разных сайтов. Что считать «одним и тем же»,
// решают articleKey и brandKey из sdk/keys.ts: второго определения этих
// правил в проекте быть не должно, иначе part и search разъедутся.

import { articleKey, brandKey } from "../sdk/index.ts"
import type { BrandHit, CrossItem, Offer, Product, Rating } from "../sdk/index.ts"

export type Per<T> = { provider: string; items: T[] }

/**
 * Сколько строк у самих сайтов. Считается, только когда хоть у одного их
 * больше, чем он отдал: иначе говорить не о чем — всё, что есть, уже на
 * экране. Молчащий про итог сайт входит в сумму тем, что прислал: это не
 * весь его склад, но и не враньё в меньшую сторону, а без него «всего у
 * сайтов» оказывалось бы меньше уже показанного.
 *
 * Прежнее правило «итог назвали все» съедало строку целиком: 22 найденных
 * из 27 печатались без единого слова о том, что выдача обрезана.
 */
export const siteTotal = (parts: { total?: number; items: unknown[] }[]): number | undefined =>
	(parts.some(p => (p.total ?? 0) > p.items.length)
		? parts.reduce((s, p) => s + Math.max(p.total ?? 0, p.items.length), 0)
		: undefined)
export type OfferRow = Offer & { provider: string }

export type MergedBrand = {
	/** Ключ склейки: brandKey. */
	key: string
	/** Написание для человека — как показал первый ответивший сайт. */
	brand: string
	article: string
	providers: string[]
	/** Провайдер → его собственное написание бренда; ему же и отправляем. */
	spelling: Record<string, string>
	/** Адрес для колонки ССЫЛКА — первый, кто его дал. */
	url?: string
	/** Провайдер → карточка этого бренда у него: страница, которую хотят открыть. */
	urls: Record<string, string>
	name?: string
	rating?: Rating
}

/**
 * Один товар у двух сайтов — две страницы, и обе нужны: `urls` хранит адрес
 * каждого сайта отдельно, а не первый попавшийся.
 */
export type MergedProduct = Product & { providers: string[]; prices: Record<string, number>; urls: Record<string, string> }

/** Из двух оценок убедительнее та, за которой больше голосов. */
const better = (a: Rating | undefined, b: Rating | undefined): Rating | undefined =>
	!a ? b : !b ? a : b.count > a.count ? b : a

export function mergeBrands(article: string, per: Per<BrandHit>[]): MergedBrand[] {
	const want = articleKey(article)
	const by = new Map<string, MergedBrand>()
	for (const { provider, items } of per) {
		for (const hit of items) {
			// Сайт вернул позицию про другой артикул — это его подсказка, а не ответ.
			if (articleKey(hit.article) !== want) continue
			const key = brandKey(hit.brand)
			const cur = by.get(key)
			if (!cur) {
				by.set(key, {
					key, brand: hit.brand, article: hit.article, providers: [provider], spelling: { [provider]: hit.brand },
					urls: hit.url ? { [provider]: hit.url } : {},
					...(hit.url ? { url: hit.url } : {}),
					...(hit.name ? { name: hit.name } : {}), ...(hit.rating ? { rating: hit.rating } : {}),
				})
				continue
			}
			if (!cur.providers.includes(provider)) cur.providers.push(provider)
			cur.spelling[provider] ??= hit.brand
			if (hit.url) {
				cur.urls[provider] ??= hit.url
				// Колонка ССЫЛКА одна на строку: если первый сайт адреса не дал,
				// его занимает следующий, а не остаётся пустой при живых ссылках.
				cur.url ??= hit.url
			}
			cur.name ??= hit.name
			cur.rating = better(cur.rating, hit.rating)
		}
	}
	return [...by.values()].sort((a, b) => b.providers.length - a.providers.length || a.key.localeCompare(b.key))
}

export function splitOffers(article: string, per: Per<Offer>[]): { offers: OfferRow[]; analogs: OfferRow[] } {
	const want = articleKey(article)
	const offers: OfferRow[] = []
	const analogs: OfferRow[] = []
	for (const { provider, items } of per) {
		for (const o of items) {
			// Аналог — либо помечен сайтом, либо это просто другой артикул.
			const where = o.analog === true || articleKey(o.article) !== want ? analogs : offers
			where.push({ ...o, provider })
		}
	}
	// Порядок по цене, а при равной — по имени сайта: выдача не должна прыгать
	// между запусками только потому, что кто-то ответил быстрее.
	const byPrice = (a: OfferRow, b: OfferRow): number => a.price - b.price || a.provider.localeCompare(b.provider)
	return { offers: offers.sort(byPrice), analogs: analogs.sort(byPrice) }
}

/**
 * Кросс-ссылка, склеенная по сайтам: один и тот же номер знают оба, и строка у
 * него должна быть одна — с колонкой «где» и адресом каждого сайта.
 */
export type MergedCross = CrossItem & { providers: string[]; urls: Record<string, string> }

export function mergeCrosses(per: Per<CrossItem>[]): MergedCross[] {
	const by = new Map<string, MergedCross>()
	for (const { provider, items } of per) {
		for (const c of items) {
			const key = `${articleKey(c.article)}|${brandKey(c.brand)}`
			const cur = by.get(key)
			if (!cur) {
				by.set(key, { ...c, providers: [provider], urls: c.url ? { [provider]: c.url } : {} })
				continue
			}
			if (!cur.providers.includes(provider)) cur.providers.push(provider)
			if (c.url) {
				cur.urls[provider] ??= c.url
				cur.url ??= c.url
			}
			if (!cur.name && c.name) cur.name = c.name
			// Вид знает не всякий сайт: armtek зовёт заменой всё подряд, а
			// autodoc отличает состав узла — знание вытесняет незнание.
			if (cur.kind === "aftermarket" && c.kind !== "aftermarket") cur.kind = c.kind
		}
	}
	// Сначала то, что знают все сайты, дальше по виду и номеру: порядок не
	// должен зависеть от того, кто ответил быстрее.
	return [...by.values()].sort((a, b) =>
		b.providers.length - a.providers.length || a.kind.localeCompare(b.kind) || a.article.localeCompare(b.article))
}

export function mergeProducts(per: Per<Product>[]): MergedProduct[] {
	const by = new Map<string, MergedProduct>()
	for (const { provider, items } of per) {
		for (const p of items) {
			const key = `${articleKey(p.article)}|${brandKey(p.brand)}`
			const cur = by.get(key)
			if (!cur) {
				by.set(key, {
					...p, providers: [provider], prices: p.price === undefined ? {} : { [provider]: p.price },
					urls: p.url ? { [provider]: p.url } : {},
				})
				continue
			}
			if (!cur.providers.includes(provider)) cur.providers.push(provider)
			if (p.url) {
				cur.urls[provider] ??= p.url
				cur.url ??= p.url
			}
			if (p.price !== undefined) {
				cur.prices[provider] = p.price
				// В колонке «ОТ» — минимум по сайтам.
				if (cur.price === undefined || p.price < cur.price) cur.price = p.price
			}
			if (!cur.name && p.name) cur.name = p.name
			if (p.quantity !== undefined) cur.quantity = Math.max(cur.quantity ?? 0, p.quantity)
			cur.rating = better(cur.rating, p.rating)
		}
	}
	return [...by.values()].sort((a, b) =>
		b.providers.length - a.providers.length
		|| (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY)
		|| a.article.localeCompare(b.article))
}

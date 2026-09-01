// map.ts — сырые ответы armtek → типы контракта. Только чистые функции:
// сюда не приходит ни сеть, ни аккаунт, поэтому всё проверяется фикстурами.

import { articleKey, brandKey } from "../../sdk/index.ts"
import type { Basket, BasketItem, BrandHit, Car, Offer, Product, Rating, Review, Reviews } from "../../sdk/contract.ts"
import type { CartWriteItem, RawArticle, RawCard, RawCartItem, RawReview, RawReviewRating, RawSuggestion, RawTransport } from "./api.ts"

export const SITE = "https://armtek.ru"

/** Карточка товара: `https://armtek.ru/product/<ARTICLE_ALIAS>`. Проверено. */
export const productUrl = (alias: string | undefined): string | undefined =>
	alias ? `${SITE}/product/${alias}` : undefined

// --- числа и даты ---------------------------------------------------------

/** Цены приходят строками («592.00»); пустая строка — это не ноль, а «нет». */
export function num(v: string | number | undefined | null): number | undefined {
	if (typeof v === "number") return Number.isFinite(v) ? v : undefined
	if (typeof v !== "string" || !v.trim()) return undefined
	const n = Number(v)
	return Number.isFinite(n) ? n : undefined
}

/**
 * Остаток. `RVALUE` — строка, и на складах с большим запасом это `">20"`.
 * Число берём как есть, а факт «не меньше» уносим в extra: показать «20 шт»
 * честнее, чем «нет в наличии», но выдавать нижнюю границу за точный остаток
 * нельзя.
 */
export function quantity(rvalue: string | undefined): { value?: number; atLeast: boolean } {
	if (!rvalue) return { atLeast: false }
	const m = rvalue.trim().match(/^(>=?|≥)?\s*(\d+(?:[.,]\d+)?)/)
	if (!m) return { atLeast: false }
	return { value: Number(m[2]!.replace(",", ".")), atLeast: !!m[1] }
}

/** `YYYYMMDDHHmmss` или `YYYYMMDD` → `YYYY-MM-DD`. */
export function isoDate(dlvdt: string | undefined): string | undefined {
	if (!dlvdt || !/^\d{8}/.test(dlvdt)) return undefined
	return `${dlvdt.slice(0, 4)}-${dlvdt.slice(4, 6)}-${dlvdt.slice(6, 8)}`
}

const dayMs = 86_400_000

/**
 * Срок в днях от сегодня. Считаем по календарным датам, а не по часам: срок
 * «завтра в 04:00» должен быть одним днём и в 23:00, и в 05:00. Прошедшая
 * дата — это ноль, а не отрицательное число: армтек иногда отдаёт срок,
 * который уже наступил, и «−1 день» в таблице выглядел бы поломкой.
 */
export function deliveryDays(dlvdt: string | undefined, today = new Date()): number | undefined {
	const iso = isoDate(dlvdt)
	if (!iso) return undefined
	const [y, m, d] = iso.split("-").map(Number) as [number, number, number]
	const target = Date.UTC(y, m - 1, d)
	const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
	return Math.max(0, Math.round((target - start) / dayMs))
}

// --- рейтинг --------------------------------------------------------------

/** `RATING` приходит строкой и пустой строкой, когда оценок нет. */
export function rating(value: string | undefined, count: number | undefined): Rating | undefined {
	const avg = num(value)
	if (avg === undefined || !count) return undefined
	return { average: avg, count }
}

// --- ref для корзины ------------------------------------------------------

/**
 * Всё, что нужно, чтобы собрать тело POST корзины, не спрашивая сайт заново.
 * Цена и точка выдачи входят сюда намеренно: они часть предложения, и класть
 * в корзину надо ровно то, что человек увидел.
 */
export type ArmtekRef = {
	artid: number
	keyzak: string
	parnr: number
	numZak: string
	prices: number
	pricem: number
	waers: string
	charg: string
	vstels: string
	zzsign: string
	minbm: number
	article: string
	brand: string
}

export function refOf(a: RawArticle, s: RawSuggestion, vstel: string): ArmtekRef {
	return {
		artid: s.ARTID ?? a.ARTID,
		keyzak: s.KEYZAK,
		parnr: num(s.PARNR) ?? 0,
		numZak: s.NUMZAK,
		prices: num(s.PRICES1) ?? 0,
		pricem: num(s.PRICEP) ?? num(s.PRICES1) ?? 0,
		waers: s.WAERS || "RUB",
		charg: s.CHARG ?? "",
		vstels: vstel,
		zzsign: "S",
		minbm: s.MINBM ?? 1,
		article: a.PIN,
		brand: a.BRAND,
	}
}

/** Проверка ref, пришедшего из argv: до сети должно дойти только осмысленное. */
export function isRef(v: unknown): v is ArmtekRef {
	const r = v as Partial<ArmtekRef> | null
	return !!r && typeof r.artid === "number" && typeof r.keyzak === "string" && !!r.keyzak
		&& typeof r.numZak === "string" && typeof r.prices === "number"
}

/** ref + количество → позиция тела POST/PUT. `posnr` 0 — «в корзине ещё нет». */
export function writeItem(r: ArmtekRef, qty: number, posnr = 0): CartWriteItem {
	return {
		keyzak: r.keyzak,
		parnr: r.parnr,
		artid: r.artid,
		kwmeng: Math.max(qty, r.minbm || 1),
		numZak: r.numZak,
		prices: r.prices,
		pricem: r.pricem,
		waers: r.waers || "RUB",
		vstels: r.vstels,
		charg: r.charg ?? "",
		zzsign: r.zzsign || "S",
		comments: "",
		podbor: "",
		status: "",
		saleCode: 0,
		parentPosnr: null,
		parentArtid: null,
		posnr,
	}
}

/** Позиция корзины → ref: `basket set` пересобирает тело из того, что лежит. */
export function refOfCartItem(i: RawCartItem, vstel: string): ArmtekRef {
	return {
		artid: i.artid,
		keyzak: i.keyzak,
		parnr: i.parnr ?? 0,
		numZak: i.numZak,
		prices: i.prices,
		pricem: num(i.pricep) ?? i.prices,
		waers: i.waers || "RUB",
		charg: i.charg ?? "",
		vstels: i.vstels || vstel,
		zzsign: i.zzsign || "S",
		minbm: i.minbm ?? 1,
		article: i.pin ?? "",
		brand: i.brand ?? "",
	}
}

// --- поиск ----------------------------------------------------------------

/** Минимальная цена и наличие по строке: в выдаче их показывают «от». */
const best = (list: RawSuggestion[] | undefined): RawSuggestion | undefined =>
	(list ?? []).reduce<RawSuggestion | undefined>(
		(acc, s) => (acc === undefined || (num(s.PRICES1) ?? Infinity) < (num(acc.PRICES1) ?? Infinity) ? s : acc), undefined)

export function toProducts(rows: RawArticle[]): Product[] {
	return rows.map(a => {
		const b = best(a.SUGGESTIONS)
		const q = quantity(b?.RVALUE)
		return {
			article: a.PIN,
			brand: a.BRAND,
			name: a.NAME ?? b?.NAME ?? a.PIN,
			...(num(b?.PRICES1) !== undefined ? { price: num(b?.PRICES1)!, currency: "RUB" as const } : {}),
			...(q.value !== undefined ? { quantity: q.value } : {}),
			...(rating(a.RATING, a.REVIEW_COUNT) ? { rating: rating(a.RATING, a.REVIEW_COUNT)! } : {}),
			...(a.PHOTO?.length ? { images: a.PHOTO } : {}),
			...(productUrl(a.ARTICLE_ALIAS) ? { url: productUrl(a.ARTICLE_ALIAS)! } : {}),
			extra: {
				artId: a.ARTID,
				...(a.ARTICLE_ALIAS ? { alias: a.ARTICLE_ALIAS } : {}),
				...(a.BRAND_ID ? { brandId: a.BRAND_ID } : {}),
				...(q.atLeast ? { quantityAtLeast: true } : {}),
				offers: a.SUGGESTIONS?.length ?? 0,
			},
		}
	})
}

/** Строки формы «card»: предложение уже слито с артикулом. */
export function cardToProducts(rows: RawCard[]): Product[] {
	return toProducts(rows.map(c => ({ ...c, NAME: c.CUSTOM_NAME || c.NAME, SUGGESTIONS: c.KEYZAK ? [c as RawSuggestion] : [] })))
}

/** Только строки, чей артикул совпадает с запрошенным после нормализации. */
export const exactRows = (rows: RawArticle[], article: string): RawArticle[] =>
	rows.filter(a => articleKey(a.PIN) === articleKey(article))

export function toBrandHits(rows: RawArticle[]): BrandHit[] {
	const seen = new Set<string>()
	const out: BrandHit[] = []
	for (const a of rows) {
		const key = brandKey(a.BRAND)
		if (seen.has(key)) continue
		seen.add(key)
		const r = rating(a.RATING, a.REVIEW_COUNT)
		out.push({
			brand: a.BRAND,
			article: a.PIN,
			...(a.NAME ? { name: a.NAME } : {}),
			...(r ? { rating: r } : {}),
			...(a.PHOTO?.length ? { images: a.PHOTO } : {}),
			extra: {
				artId: a.ARTID,
				...(a.ARTICLE_ALIAS ? { alias: a.ARTICLE_ALIAS } : {}),
				...(a.BRAND_ID ? { brandId: a.BRAND_ID } : {}),
				offers: a.SUGGESTIONS?.length ?? 0,
			},
		})
	}
	return out
}

/**
 * Предложения. Одна строка выдачи разворачивается в столько Offer, сколько у
 * неё SUGGESTIONS: они отличаются складом, ценой и сроком.
 *
 * `seller` — код склада `KEYZAK`: продавец везде один (armtek), а различает
 * строки именно склад, и без него колонка была бы бессмысленной.
 */
export function toOffers(rows: RawArticle[], want: { article: string; brand: string }, vstel: string, today = new Date()): Offer[] {
	const wantArticle = articleKey(want.article)
	const wantBrand = brandKey(want.brand)
	const out: Offer[] = []
	for (const a of rows) {
		const analog = articleKey(a.PIN) !== wantArticle || brandKey(a.BRAND) !== wantBrand
		const r = rating(a.RATING, a.REVIEW_COUNT)
		for (const s of a.SUGGESTIONS ?? []) {
			const q = quantity(s.RVALUE)
			const days = deliveryDays(s.DLVDT, today)
			out.push({
				article: a.PIN,
				brand: a.BRAND,
				name: a.NAME ?? s.NAME ?? a.PIN,
				price: num(s.PRICES1) ?? 0,
				currency: "RUB",
				...(q.value !== undefined ? { quantity: q.value } : {}),
				...(days !== undefined ? { deliveryDays: days } : {}),
				...(isoDate(s.DLVDT) ? { deliveryDate: isoDate(s.DLVDT)! } : {}),
				seller: s.KEYZAK,
				stock: { code: s.KEYZAK },
				...(r ? { rating: r } : {}),
				...(a.PHOTO?.length ? { images: a.PHOTO } : {}),
				...(productUrl(a.ARTICLE_ALIAS) ? { url: productUrl(a.ARTICLE_ALIAS)! } : {}),
				ref: refOf(a, s, vstel) as unknown as Record<string, unknown>,
				...(analog ? { analog: true, analogOf: { article: want.article, brand: want.brand } } : {}),
				extra: {
					artId: a.ARTID,
					...(q.atLeast ? { quantityAtLeast: true } : {}),
					...(s.TYPE ? { type: s.TYPE } : {}),
					...(num(s.PRICEP) !== undefined ? { priceOld: num(s.PRICEP)! } : {}),
					...(s.MINBM ? { minQuantity: s.MINBM } : {}),
					...(isoDate(s.ORDDT) ? { orderBefore: s.ORDDT } : {}),
				},
			})
		}
	}
	// Дешёвое первым, при равной цене — быстрое: так же сортирует сам сайт.
	return out.sort((x, y) => x.price - y.price || (x.deliveryDays ?? 999) - (y.deliveryDays ?? 999))
}

// --- отзывы ---------------------------------------------------------------

/**
 * Автор — имя и первая буква фамилии. Полное ФИО и телефон армтек отдаёт
 * любому гостю, но тиражировать их через свой вывод мы не будем.
 */
export function author(r: RawReview): string | undefined {
	const first = r.firstName?.trim()
	const last = r.lastName?.trim()
	if (!first && !last) return undefined
	if (!last) return first
	return first ? `${first} ${[...last][0]!.toUpperCase()}.` : `${[...last][0]!.toUpperCase()}.`
}

export function toReviews(list: { paginator?: { totalCount?: number }; items?: RawReview[] } | null, stats: RawReviewRating | undefined): Reviews {
	const items: Review[] = (list?.items ?? []).map(r => ({
		...(author(r) ? { author: author(r)! } : {}),
		...(r.createdDate ? { date: r.createdDate.slice(0, 10) } : {}),
		...(r.rating ? { rating: r.rating } : {}),
		text: r.text ?? "",
	}))
	const total = stats?.reviewCount ?? list?.paginator?.totalCount ?? items.length
	const avg = num(stats?.rating)
	return {
		total,
		...(stats && avg !== undefined ? {
			rating: {
				average: avg,
				count: stats.reviewCount,
				histogram: [stats.fiveStarsCount, stats.fourStarsCount, stats.threeStarsCount, stats.twoStarsCount, stats.oneStarsCount],
			},
		} : {}),
		items,
	}
}

// --- корзина --------------------------------------------------------------

export function toBasket(raw: { items?: RawCartItem[] } | null, vstel: string, today = new Date()): Basket {
	const items: BasketItem[] = (raw?.items ?? []).map(i => {
		const days = deliveryDays(i.dateDel, today)
		return {
			id: String(i.posnr),
			article: i.pin ?? "",
			brand: i.brand ?? "",
			...(i.name ? { name: i.name } : {}),
			price: i.prices,
			quantity: i.kwmeng,
			sum: i.prices * i.kwmeng,
			seller: i.keyzak,
			...(days !== undefined ? { deliveryDays: days } : {}),
			...(isoDate(i.dateDel) ? { deliveryDate: isoDate(i.dateDel)! } : {}),
			extra: {
				artId: i.artid,
				...(i.articleAlias ? { alias: i.articleAlias } : {}),
				ref: refOfCartItem(i, vstel),
			},
		}
	})
	return {
		items,
		total: items.reduce((s, i) => s + (i.sum ?? 0), 0),
		currency: "RUB",
		url: `${SITE}/basket`,
	}
}

// --- гараж ----------------------------------------------------------------

const opt = (t: RawTransport, key: string): string | undefined =>
	t.options?.find(o => o.key === key)?.value || undefined

export function toCars(list: RawTransport[] | undefined): Car[] {
	// active !== "1" — удалённая или скрытая машина; фронт их тоже прячет
	return (list ?? []).filter(t => t.active === undefined || t.active === "1").map(t => {
		const year = num(t.manufacture_year?.value)
		const odometer = num(opt(t, "mileage"))
		const engine = [opt(t, "engine_capacity"), opt(t, "engine_type")].filter(Boolean).join(" ")
		return {
			brand: t.brand?.value ?? "",
			model: t.model_name?.value ?? "",
			...(t.modification?.value ? { modification: t.modification.value } : {}),
			...(year !== undefined ? { year } : {}),
			...(engine ? { engine } : {}),
			...(t.vin?.value ? { vin: t.vin.value } : {}),
			...(odometer !== undefined ? { odometer } : {}),
			ref: {
				transportId: t.transportId ?? null,
				...(t.license_plate_number ? { plate: t.license_plate_number } : {}),
				...(t.additional?.garage_type_title ? { type: t.additional.garage_type_title } : {}),
			},
		}
	})
}

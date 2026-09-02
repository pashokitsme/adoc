// map.ts — сырые ответы armtek → типы контракта. Только чистые функции:
// сюда не приходит ни сеть, ни аккаунт, поэтому всё проверяется фикстурами.

import { articleKey, brandKey } from "../../sdk/index.ts"
import type { Basket, BasketItem, BrandHit, Car, Info, Offer, Order, OrderItem, Product, Rating, Review, Reviews } from "../../sdk/contract.ts"
import type { CartWriteItem, RawArticle, RawCard, RawCartItem, RawOrder, RawReview, RawReviewRating, RawSuggestion, RawTransport } from "./api.ts"

export const SITE = "https://armtek.ru"

/**
 * Продавец в выдаче ровно один — сам магазин. Склад различает строки, но его
 * человекочитаемого названия сайт не отдаёт, поэтому код склада уходит в
 * `extra.keyzak`, а не притворяется именем продавца.
 */
export const SELLER = "armtek"

/**
 * Карточка товара: `https://armtek.ru/product/<ARTICLE_ALIAS>`. Без алиаса
 * сайт подставляет в тот же маршрут `ARTID` — так делает и его собственный
 * шаблон карточки, поэтому позиция без алиаса всё равно получает адрес.
 * Уценённая партия живёт отдельно: `/product/markdown/<alias>/<charg>`.
 */
export const productUrl = (alias: string | undefined, artId?: number, charg?: string): string | undefined => {
	if (alias && charg) return `${SITE}/product/markdown/${alias}/${charg}`
	if (alias) return `${SITE}/product/${alias}`
	return artId ? `${SITE}/product/${artId}` : undefined
}

export const BASKET_URL = `${SITE}/basket`
export const ORDERS_URL = `${SITE}/profile/orders`

/** Карточка заказа: `?orderId=<VBELN>`, а без номера — по хэшу. */
export const orderUrl = (vbeln: string | undefined, guid: string | undefined): string | undefined => {
	if (vbeln) return `${ORDERS_URL}/card?orderId=${encodeURIComponent(vbeln)}`
	return guid ? `${ORDERS_URL}/card?orderHash=${encodeURIComponent(guid)}` : ORDERS_URL
}

/**
 * Название как его показывает сайт. В SAP-выгрузке armtek внутри имени живёт
 * разметка: «фильтр масляный!\\ Mazda 626, Mitsubishi Galant 1.8-2.5i 91>» —
 * `!` и обратная косая разделяют имя детали и применимость. Оставлять это в
 * выдаче нельзя (человек читает «!\\»), выбрасывать применимость — тоже: она
 * единственное, чем строки отличаются друг от друга. Поэтому разделитель
 * становится тем, чем он и был по смыслу, а лишние пробелы схлопываются.
 *
 * Единственное место на весь провайдер: одно и то же имя приходит и в поиске,
 * и в предложениях, и в корзине, и в заказе.
 */
export function cleanName(v: string | undefined): string | undefined {
	if (!v) return undefined
	const out = v
		.replace(/\s*!?\\+\s*/g, " · ")
		.replace(/\s+/g, " ")
		.replace(/\s*·\s*$/, "")
		.trim()
	return out || undefined
}

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

/**
 * SAP-дата `YYYYMMDD[HHmmss]` → `YYYY-MM-DD`. Пустую дату SAP пишет как
 * «00000000», а мусор бывает и просто мусором: всё, что не настоящая дата,
 * возвращается как undefined — «срок 0000-00-00» в выдаче хуже, чем его
 * отсутствие. Имя своё, не isoDate: у SDK isoDate режет ISO-строку, а тут
 * разбирается формат сайта.
 */
export function sapDate(dlvdt: string | undefined): string | undefined {
	const m = dlvdt ? /^(\d{4})(\d{2})(\d{2})/.exec(dlvdt) : null
	if (!m) return undefined
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
	// setUTCFullYear, а не Date.UTC: тот молча превращает год 0 в 1900
	const probe = new Date(0)
	probe.setUTCFullYear(y, mo - 1, d)
	if (probe.getUTCFullYear() !== y || probe.getUTCMonth() + 1 !== mo || probe.getUTCDate() !== d) return undefined
	return `${m[1]}-${m[2]}-${m[3]}`
}

const dayMs = 86_400_000

/**
 * Срок в днях от сегодня. Считаем по календарным датам, а не по часам: срок
 * «завтра в 04:00» должен быть одним днём и в 23:00, и в 05:00. Прошедшая
 * дата — это ноль, а не отрицательное число: армтек иногда отдаёт срок,
 * который уже наступил, и «−1 день» в таблице выглядел бы поломкой.
 */
export function deliveryDays(dlvdt: string | undefined, today = new Date()): number | undefined {
	const iso = sapDate(dlvdt)
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

// --- машина и категории ---------------------------------------------------

/**
 * Ref машины → фильтр по машине. Годится любой ref, в котором есть
 * идентификатор модификации TecDoc: у armtek он зовётся `linkingTargetId`, у
 * autodoc ровно то же число лежит в `modificationId` (проверено — оба сайта
 * сидят на TecDoc). Нет числа — нет фильтра, и провайдер скажет об этом вслух,
 * а не сделает вид, что нашёл под машину.
 */
export function carTarget(ref: Record<string, unknown> | null):
	{ linkingTargetId: number; linkingTargetType: string } | undefined {
	if (!ref) return undefined
	const id = [ref.linkingTargetId, ref.modificationId, ref.carId].find(v => typeof v === "number" && v > 0)
	if (typeof id !== "number") return undefined
	const type = typeof ref.linkingTargetType === "string" && ref.linkingTargetType ? ref.linkingTargetType : "P"
	return { linkingTargetId: id, linkingTargetType: type }
}

/**
 * Какая из подсказанных категорий отвечает на запрос: доля слов её названия,
 * нашедшихся в запросе. Слова сравниваются по общему префиксу, иначе «свеча» и
 * «свечи» разошлись бы. Ничья — за первой, то есть порядок сайта значим.
 *
 * Ни одного общего слова — категории нет. Это важно: на артикул подсказка
 * тоже отвечает какой-нибудь категорией, и без этой проверки поиск по номеру
 * ушёл бы в чужой раздел вместо свободного поиска.
 */
const words = (s: string): string[] =>
	s.toLowerCase().replace(/ё/g, "е").split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1)

const sameWord = (a: string, b: string): boolean => {
	const n = Math.min(a.length, b.length)
	let i = 0
	while (i < n && a[i] === b[i]) i++
	return i >= Math.min(4, n)
}

export function bestCategory<T extends { NAME: string }>(cats: T[], query: string): T | undefined {
	const q = words(query)
	let best: T | undefined
	let bestScore = -1
	for (const c of cats) {
		const t = words(c.NAME)
		if (!t.length) continue
		const score = t.filter(w => q.some(x => sameWord(w, x))).length / t.length
		if (score > bestScore) { bestScore = score; best = c }
	}
	return bestScore > 0 ? best : undefined
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
			name: cleanName(a.NAME ?? b?.NAME) ?? a.PIN,
			...(num(b?.PRICES1) !== undefined ? { price: num(b?.PRICES1)!, currency: "RUB" as const } : {}),
			...(q.value !== undefined ? { quantity: q.value } : {}),
			...(rating(a.RATING, a.REVIEW_COUNT) ? { rating: rating(a.RATING, a.REVIEW_COUNT)! } : {}),
			...(a.PHOTO?.length ? { images: a.PHOTO } : {}),
			...(productUrl(a.ARTICLE_ALIAS, a.ARTID) ? { url: productUrl(a.ARTICLE_ALIAS, a.ARTID)! } : {}),
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

/**
 * Строки формы «card»: предложение уже слито с артикулом. Контрактные команды
 * этой формой не пользуются (её берёт своя команда `info`, и та работает с
 * сырыми строками), так что живой вызывающий здесь только тест — он и держит
 * покрытие на разборе этой формы ответа.
 */
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
			...(cleanName(a.NAME) ? { name: cleanName(a.NAME)! } : {}),
			...(r ? { rating: r } : {}),
			...(a.PHOTO?.length ? { images: a.PHOTO } : {}),
			...(productUrl(a.ARTICLE_ALIAS, a.ARTID) ? { url: productUrl(a.ARTICLE_ALIAS, a.ARTID)! } : {}),
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
 * Имя детали → запросы для подсказки категорий, от длинного к короткому.
 * Сайт кладёт в имя ещё и применимость («болт амортизатора пер. · Audi A3
 * …»), а подсказка на такую строку отвечает пустотой — проверено вживую:
 * целиком она не даёт ни одной категории, «болт амортизатора» даёт «Болты и
 * винты автомобильные». Поэтому пробуем по очереди: всё до «·», три слова, два.
 */
export function categoryQueries(name: string): string[] {
	const head = (name.split("·")[0] ?? name).trim()
	const words = head.split(/\s+/).filter(Boolean)
	const tries = [head, words.slice(0, 3).join(" "), words.slice(0, 2).join(" ")]
	return [...new Set(tries.filter(q => q.length > 2))]
}
/**
 * Предложения. Одна строка выдачи разворачивается в столько Offer, сколько у
 * неё SUGGESTIONS: они отличаются складом, ценой и сроком.
 *
 * Продавец здесь один — сам armtek, а человекочитаемого названия склада
 * выдача не отдаёт: `KEYZAK` — это код вроде «MOV0000019», и по контракту
 * коды живут в `extra`, а не в `seller`.
 *
 * Строка без цены — не предложение: в корзину её не положить и сравнивать
 * не с чем, поэтому она выбрасывается, а не показывается ценой 0.
 */
export function toOffers(rows: RawArticle[], want: { article: string; brand: string }, vstel: string, today = new Date()): Offer[] {
	const wantArticle = articleKey(want.article)
	const wantBrand = brandKey(want.brand)
	const out: Offer[] = []
	for (const a of rows) {
		const analog = articleKey(a.PIN) !== wantArticle || brandKey(a.BRAND) !== wantBrand
		const r = rating(a.RATING, a.REVIEW_COUNT)
		for (const s of a.SUGGESTIONS ?? []) {
			const price = num(s.PRICES1)
			if (price === undefined) continue
			const q = quantity(s.RVALUE)
			const days = deliveryDays(s.DLVDT, today)
			out.push({
				article: a.PIN,
				brand: a.BRAND,
				name: cleanName(a.NAME ?? s.NAME) ?? a.PIN,
				price,
				currency: "RUB",
				...(q.value !== undefined ? { quantity: q.value } : {}),
				...(days !== undefined ? { deliveryDays: days } : {}),
				...(sapDate(s.DLVDT) ? { deliveryDate: sapDate(s.DLVDT)! } : {}),
				seller: SELLER,
				...(r ? { rating: r } : {}),
				...(a.PHOTO?.length ? { images: a.PHOTO } : {}),
				...(productUrl(a.ARTICLE_ALIAS, a.ARTID) ? { url: productUrl(a.ARTICLE_ALIAS, a.ARTID)! } : {}),
				ref: refOf(a, s, vstel) as unknown as Record<string, unknown>,
				...(analog ? { analog: true, analogOf: { article: want.article, brand: want.brand } } : {}),
				extra: {
					artId: a.ARTID,
					keyzak: s.KEYZAK,
					...(q.atLeast ? { quantityAtLeast: true } : {}),
					...(s.TYPE ? { type: s.TYPE } : {}),
					...(num(s.PRICEP) !== undefined ? { priceOld: num(s.PRICEP)! } : {}),
					...(s.MINBM ? { minQuantity: s.MINBM } : {}),
					...(sapDate(s.ORDDT) ? { orderBefore: s.ORDDT } : {}),
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

export function toReviews(list: { paginator?: { totalCount?: number }; items?: RawReview[] } | null, stats: RawReviewRating | undefined, url?: string): Reviews {
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
		// отдельной страницы отзывов у armtek нет: лента живёт на карточке
		// товара и листается скроллом, якоря в адресе тоже нет
		...(url ? { url } : {}),
	}
}

// --- карточка -------------------------------------------------------------

/**
 * Карточка из строк формы «card»: там предложение слито с артикулом, поэтому
 * одна деталь видна целиком — все склады, цены и сроки одним списком.
 * Наличие по складам и есть `stock`: `KEYZAK` — код склада, человеческого
 * имени сайт не отдаёт.
 */
export function toInfo(rows: RawCard[], stats: RawReviewRating | undefined, today = new Date()): Info {
	const head = rows[0]!
	const prices = rows.map(c => num(c.PRICES1)).filter((v): v is number => v !== undefined)
	const daysList = rows.map(c => deliveryDays(c.DLVDT, today)).filter((v): v is number => v !== undefined)
	const avg = num(stats?.rating)
	return {
		article: head.PIN,
		brand: head.BRAND,
		// в форме card NAME — название предложения, человеческое лежит в CUSTOM_NAME
		name: cleanName(head.CUSTOM_NAME || head.NAME) ?? head.PIN,
		...(productUrl(head.ARTICLE_ALIAS, head.ARTID) ? { url: productUrl(head.ARTICLE_ALIAS, head.ARTID)! } : {}),
		...(stats && avg !== undefined ? {
			rating: {
				average: avg,
				count: stats.reviewCount,
				histogram: [stats.fiveStarsCount, stats.fourStarsCount, stats.threeStarsCount, stats.twoStarsCount, stats.oneStarsCount],
			},
		} : {}),
		...(head.PHOTO?.length ? { images: head.PHOTO } : {}),
		...(prices.length ? { price: Math.min(...prices), currency: "RUB" as const } : {}),
		...(daysList.length ? { deliveryDays: Math.min(...daysList) } : {}),
		// Имени у склада нет нигде: ни в строке выдачи, ни в all-suggestions, ни в
		// списке точек выдачи (KEYZAK вида MOV0000019 и vstel вида ME86 — разные
		// пространства имён, проверено). Поэтому виден код, а различает строки
		// срок — его и кладём рядом.
		stock: rows.filter(c => c.KEYZAK).map(c => ({
			code: c.KEYZAK!,
			...(quantity(c.RVALUE).value !== undefined ? { quantity: quantity(c.RVALUE).value } : {}),
			...(deliveryDays(c.DLVDT, today) !== undefined ? { deliveryDays: deliveryDays(c.DLVDT, today) } : {}),
		})),
		extra: { artId: head.ARTID, ...(head.ARTICLE_ALIAS ? { alias: head.ARTICLE_ALIAS } : {}), offers: rows.length },
	}
}

// --- заказы ---------------------------------------------------------------

/** SAP-число строкой: суммы в заказе приходят и числом, и «1234.00». */
const orderNum = (v: number | string | undefined): number => num(v) ?? 0

/**
 * Заказы. Форма строки взята из бандла сайта: у аккаунта заказов нет, поэтому
 * все поля читаются мягко — лишь бы не уронить команду на чужой раскладке.
 */
export function toOrders(list: RawOrder[] | undefined): Order[] {
	return (list ?? []).map(o => {
		const items: OrderItem[] = (o.ITEMS ?? []).map(i => {
			const price = orderNum(i.PRICE)
			const qty = orderNum(i.KWMENG) || 1
			return {
				article: i.PIN ?? "",
				brand: i.BRAND ?? "",
				name: cleanName(i.ARTICLE_NAME || i.NAME) ?? "",
				qty,
				price,
				sum: num(i.NETWR) ?? price * qty,
				...(productUrl(i.ARTICLE_ALIAS, i.ARTID, i.CHARG || undefined) ? { url: productUrl(i.ARTICLE_ALIAS, i.ARTID, i.CHARG || undefined)! } : {}),
			}
		})
		const vbeln = o.VBELN === undefined ? undefined : String(o.VBELN)
		return {
			id: vbeln ?? o.GUID ?? "",
			date: sapDate(o.CREDT) ?? o.ORDER_DATE ?? o.date ?? "",
			status: o.ORDER_STATUS ?? "",
			total: orderNum(o.NETWR) || items.reduce((s, i) => s + (i.sum ?? 0), 0),
			currency: "RUB",
			...(orderUrl(vbeln, o.GUID) ? { url: orderUrl(vbeln, o.GUID)! } : {}),
			...(items.length ? { items } : {}),
			extra: {
				...(o.GUID ? { guid: o.GUID } : {}),
				...(o.PAYMENT_STATUS ? { paymentStatus: o.PAYMENT_STATUS } : {}),
				...(o.PAYMENT_TYPE ? { paymentType: o.PAYMENT_TYPE } : {}),
			},
		}
	})
}

// --- корзина --------------------------------------------------------------

export function toBasket(raw: { items?: RawCartItem[] } | null, vstel: string, today = new Date()): Basket {
	const items: BasketItem[] = (raw?.items ?? []).map(i => {
		const days = deliveryDays(i.dateDel, today)
		return {
			id: String(i.posnr),
			article: i.pin ?? "",
			brand: i.brand ?? "",
			...(cleanName(i.name) ? { name: cleanName(i.name)! } : {}),
			price: i.prices,
			quantity: i.kwmeng,
			sum: i.prices * i.kwmeng,
			seller: SELLER,
			...(days !== undefined ? { deliveryDays: days } : {}),
			...(sapDate(i.dateDel) ? { deliveryDate: sapDate(i.dateDel)! } : {}),
			...(productUrl(i.articleAlias, i.artid, i.charg || undefined) ? { url: productUrl(i.articleAlias, i.artid, i.charg || undefined)! } : {}),
			extra: {
				artId: i.artid,
				keyzak: i.keyzak,
				...(i.articleAlias ? { alias: i.articleAlias } : {}),
				ref: refOfCartItem(i, vstel),
			},
		}
	})
	return {
		items,
		total: items.reduce((s, i) => s + (i.sum ?? 0), 0),
		currency: "RUB",
		url: BASKET_URL,
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

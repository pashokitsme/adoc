// Перевод сырых ответов armtek в типы контракта — на записанных фикстурах.
// Сети нет: map.ts состоит из чистых функций.

import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { RawArticle, RawCard, RawCart, RawGarage, RawReview, RawReviewRating } from "../../src/providers/armtek/api.ts"
import {
	author, bestCategory, cardToProducts, carTarget, cleanName, deliveryDays, exactRows, isRef, num, orderUrl,
	productUrl, quantity, refOf, refOfCartItem, sapDate, toBasket, toBrandHits, toCars, toInfo,
	toOffers, toOrders, toProducts, toReviews, writeItem,
} from "../../src/providers/armtek/map.ts"

const DIR = join(import.meta.dir, "..", "fixtures", "armtek")
const fixture = async <T = any>(name: string): Promise<T> => await Bun.file(join(DIR, name)).json() as T

const searchRows = async (): Promise<RawArticle[]> => (await fixture("search-list.json")).data.articlesData
const groupRows = async (): Promise<RawArticle[]> => (await fixture("search-brand-group.json")).data.articlesData

/** Фиксированное «сегодня»: сроки в фикстурах привязаны к 2026-09-02. */
const TODAY = new Date(2026, 8, 2, 12, 0, 0)

describe("числа и даты", () => {
	test("цены приходят строками, пустая строка — не ноль", () => {
		expect(num("592.00")).toBe(592)
		expect(num("")).toBeUndefined()
		expect(num(undefined)).toBeUndefined()
		expect(num("нет")).toBeUndefined()
		expect(num(0)).toBe(0)
	})

	test("RVALUE «>20» — нижняя граница, а не точное число", () => {
		expect(quantity("46")).toEqual({ value: 46, atLeast: false })
		expect(quantity(">20")).toEqual({ value: 20, atLeast: true })
		expect(quantity("")).toEqual({ atLeast: false })
		expect(quantity("много")).toEqual({ atLeast: false })
	})

	test("DLVDT — YYYYMMDDHHmmss", () => {
		expect(sapDate("20260902040000")).toBe("2026-09-02")
		expect(sapDate("20260902")).toBe("2026-09-02")
		expect(sapDate("")).toBeUndefined()
		expect(sapDate("завтра")).toBeUndefined()
	})

	test("пустая дата SAP и несуществующие числа — не дата", () => {
		expect(sapDate("00000000")).toBeUndefined()
		expect(sapDate("20261301")).toBeUndefined() // тринадцатого месяца не бывает
		expect(sapDate("20260231")).toBeUndefined() // 31 февраля тоже
		expect(sapDate("20260229")).toBeUndefined() // 2026 не високосный
		expect(sapDate("20240229")).toBe("2024-02-29")
	})

	test("«00000000» не превращается в срок доставки", () => {
		expect(deliveryDays("00000000", TODAY)).toBeUndefined()
		expect(deliveryDays("20261301", TODAY)).toBeUndefined()
	})

	test("срок считается по календарным дням, а не по часам", () => {
		// 04:00 следующего дня — это один день и в 23:00, и в 05:00
		expect(deliveryDays("20260903040000", new Date(2026, 8, 2, 23, 30))).toBe(1)
		expect(deliveryDays("20260903040000", new Date(2026, 8, 2, 5, 0))).toBe(1)
		expect(deliveryDays("20260902040000", TODAY)).toBe(0)
	})

	test("прошедший срок — ноль, а не отрицательное число", () => {
		expect(deliveryDays("20260801000000", TODAY)).toBe(0)
	})

	test("URL карточки собирается из ARTICLE_ALIAS", () => {
		expect(productUrl("filtr-55469")).toBe("https://armtek.ru/product/filtr-55469")
		expect(productUrl(undefined)).toBeUndefined()
	})
})

describe("search → Product", () => {
	test("строка выдачи становится товаром, цена берётся минимальная", async () => {
		const items = toProducts(await searchRows())
		const bosch = items.find(p => p.brand === "BOSCH")!
		expect(bosch.article).toBe("0 986 452 041")
		expect(bosch.price).toBe(592)
		expect(bosch.currency).toBe("RUB")
		expect(bosch.rating).toEqual({ average: 5, count: 2 })
		expect(bosch.url).toContain("https://armtek.ru/product/")
		expect(bosch.extra!.artId).toBe(55469)
	})

	test("у строки с несколькими предложениями показывается дешёвое", async () => {
		const rows = await searchRows()
		const multi = rows.find(a => (a.SUGGESTIONS?.length ?? 0) > 1)!
		const p = toProducts([multi])[0]!
		const prices = multi.SUGGESTIONS!.map(s => Number(s.PRICES1))
		expect(p.price).toBe(Math.min(...prices))
		expect(p.extra!.offers).toBe(multi.SUGGESTIONS!.length)
	})

	test("«>20» переносится в quantity плюс пометку в extra", async () => {
		const p = toProducts(await searchRows()).find(x => x.brand === "BOSCH")!
		expect(p.quantity).toBe(20)
		expect(p.extra!.quantityAtLeast).toBe(true)
	})

	test("без отзывов рейтинга нет вовсе, а не нулевой", async () => {
		const rows = await searchRows()
		const none = rows.find(a => !a.REVIEW_COUNT)
		if (none) expect(toProducts([none])[0]!.rating).toBeUndefined()
	})

	test("форма card тоже превращается в товары", async () => {
		const rows: RawCard[] = (await fixture("search-card.json")).data.articlesData
		const items = cardToProducts(rows)
		expect(items).toHaveLength(rows.length)
		expect(items[0]!.article).toBe(rows[0]!.PIN)
		expect(items[0]!.price).toBe(Number(rows[0]!.PRICES1))
	})
})

describe("brands", () => {
	test("один бренд — одна строка, даже если PIN написан по-разному", async () => {
		const rows = await groupRows()
		const hits = toBrandHits(rows)
		expect(hits.length).toBe(new Set(rows.map(a => a.BRAND.toUpperCase())).size)
		expect(hits.every(h => h.article && h.brand)).toBe(true)
		expect(hits[0]!.extra!.artId).toBeDefined()
	})

	test("точные совпадения отбираются по нормализованному артикулу", async () => {
		const rows = await searchRows()
		expect(exactRows(rows, "0986452041").map(a => a.BRAND)).toEqual(["BOSCH"])
		expect(exactRows(rows, "0 986 452 041")).toHaveLength(1)
		expect(exactRows(rows, "нет-такого")).toHaveLength(0)
	})
})

describe("offers", () => {
	test("каждое предложение — отдельный Offer со складом и сроком", async () => {
		const rows = await searchRows()
		const bosch = rows.find(a => a.BRAND === "BOSCH")!
		const items = toOffers([bosch], { article: "0986452041", brand: "BOSCH" }, "ME86", TODAY)
		expect(items).toHaveLength(bosch.SUGGESTIONS!.length)
		const o = items[0]!
		expect(o.price).toBe(592)
		expect(o.currency).toBe("RUB")
		// продавец один — сам магазин; код склада живёт в extra, а не в seller
		expect(o.seller).toBe("armtek")
		expect(o.stock).toBeUndefined()
		expect(o.extra!.keyzak).toBe("MOV0000019")
		expect(o.deliveryDate).toBe("2026-09-02")
		expect(o.deliveryDays).toBe(0)
		expect(o.analog).toBeUndefined()
	})

	test("строка без цены — не предложение и в выдачу не идёт", async () => {
		const rows = await searchRows()
		const bosch = rows.find(a => a.BRAND === "BOSCH")!
		const priceless = { ...bosch.SUGGESTIONS![0]!, PRICES1: "", KEYZAK: "БЕЗ ЦЕНЫ" }
		const row: RawArticle = { ...bosch, SUGGESTIONS: [priceless, ...bosch.SUGGESTIONS!] }
		const items = toOffers([row], { article: "0986452041", brand: "BOSCH" }, "ME86", TODAY)
		expect(items).toHaveLength(bosch.SUGGESTIONS!.length)
		expect(items.some(o => o.price === 0)).toBe(false)
		expect(items.some(o => o.extra!.keyzak === "БЕЗ ЦЕНЫ")).toBe(false)
	})

	test("чужой бренд или чужой артикул помечается аналогом", async () => {
		const items = toOffers(await searchRows(), { article: "0986452041", brand: "BOSCH" }, "ME86", TODAY)
		const analogs = items.filter(o => o.analog)
		expect(analogs.length).toBeGreaterThan(0)
		expect(analogs.every(o => o.analogOf!.brand === "BOSCH")).toBe(true)
		expect(items.filter(o => !o.analog).every(o => o.brand === "BOSCH")).toBe(true)
	})

	test("сортировка: дешевле первым", async () => {
		const items = toOffers(await searchRows(), { article: "0986452041", brand: "BOSCH" }, "ME86", TODAY)
		const prices = items.map(o => o.price)
		expect([...prices].sort((a, b) => a - b)).toEqual(prices)
	})

	test("ref несёт всё для POST корзины — второй запрос не нужен", async () => {
		const rows = await searchRows()
		const bosch = rows.find(a => a.BRAND === "BOSCH")!
		const ref = refOf(bosch, bosch.SUGGESTIONS![0]!, "ME86")
		expect(isRef(ref)).toBe(true)
		const body = writeItem(ref, 2)
		expect(body).toEqual({
			keyzak: "MOV0000019", parnr: 0, artid: 55469, kwmeng: 2, numZak: "1",
			prices: 592, pricem: 624, waers: "RUB", vstels: "ME86", charg: "",
			zzsign: "S", comments: "", podbor: "", status: "", saleCode: 0,
			parentPosnr: null, parentArtid: null, posnr: 0,
		})
	})

	test("количество не опускается ниже минимальной партии", () => {
		const ref = { artid: 1, keyzak: "K", parnr: 0, numZak: "1", prices: 10, pricem: 10, waers: "RUB", charg: "", vstels: "ME86", zzsign: "S", minbm: 4, article: "A", brand: "B" }
		expect(writeItem(ref, 1).kwmeng).toBe(4)
		expect(writeItem(ref, 9).kwmeng).toBe(9)
	})

	test("мусорный ref до сети не доходит", () => {
		expect(isRef(null)).toBe(false)
		expect(isRef({})).toBe(false)
		expect(isRef({ artid: "55469", keyzak: "K", numZak: "1", prices: 1 })).toBe(false)
		expect(isRef({ artid: 1, keyzak: "", numZak: "1", prices: 1 })).toBe(false)
	})
})

describe("reviews", () => {
	test("оценки, гистограмма и лента собираются вместе", async () => {
		const list = (await fixture("reviews-list.json")).data as { paginator: any; items: RawReview[] }
		const stats = (await fixture("reviews-rating.json")).data[0] as RawReviewRating
		const r = toReviews(list, stats)
		expect(r.total).toBe(2)
		expect(r.rating).toEqual({ average: 5, count: 2, histogram: [2, 0, 0, 0, 0] })
		expect(r.items).toHaveLength(2)
		expect(r.items[0]!.date).toBe("2025-10-20")
		expect(r.items[0]!.rating).toBe(5)
		expect(r.items[0]!.text.length).toBeGreaterThan(0)
	})

	test("наружу уходит имя и буква фамилии, но никогда телефон", () => {
		expect(author({ id: 1, text: "", rating: 5, artId: 1, firstName: "Сергей", lastName: "Самаркин", createdUser: "79990000000" })).toBe("Сергей С.")
		expect(author({ id: 1, text: "", rating: 5, artId: 1, firstName: "Сергей" })).toBe("Сергей")
		expect(author({ id: 1, text: "", rating: 5, artId: 1 })).toBeUndefined()
	})

	test("телефон автора не попадает ни в одно поле Review", async () => {
		const list = { paginator: { totalCount: 1 }, items: [{ id: 1, text: "ок", rating: 5, artId: 1, createdUser: "79990000000", firstName: "Иван", lastName: "Иванов", createdDate: "2025-01-02 03:04:05" }] }
		const r = toReviews(list, undefined)
		expect(JSON.stringify(r)).not.toContain("79990000000")
		expect(r.items[0]!.author).toBe("Иван И.")
		expect(r.total).toBe(1)
	})

	test("без оценок лента всё равно отдаётся", async () => {
		const r = toReviews({ paginator: { totalCount: 0 }, items: [] }, undefined)
		expect(r.rating).toBeUndefined()
		expect(r.items).toEqual([])
	})
})

describe("basket", () => {
	test("позиция корзины: id — это posnr, сумма считается нами", async () => {
		const raw = (await fixture("cart-list.json")).data as RawCart
		const b = toBasket(raw, "ME86", TODAY)
		expect(b.currency).toBe("RUB")
		expect(b.url).toBe("https://armtek.ru/basket")
		const i = b.items[0]!
		expect(i.id).toBe("1")
		expect(i.article).toBe("0 986 452 041")
		expect(i.brand).toBe("BOSCH")
		expect(i.price).toBe(592)
		expect(i.quantity).toBe(1)
		expect(i.sum).toBe(592)
		expect(b.total).toBe(592)
		expect(i.deliveryDate).toBe("2026-09-02")
	})

	test("из позиции корзины собирается ref для смены количества", async () => {
		const raw = (await fixture("cart-list.json")).data as RawCart
		const ref = refOfCartItem(raw.items[0]!, "ME86")
		expect(isRef(ref)).toBe(true)
		const body = writeItem(ref, 3, 1)
		expect(body.posnr).toBe(1)
		expect(body.kwmeng).toBe(3)
		expect(body.prices).toBe(592)
		expect(body.pricem).toBe(624)
	})

	test("пустая корзина — пустой список, а не падение", () => {
		expect(toBasket({ items: [] }, "ME86")).toMatchObject({ items: [], total: 0 })
		expect(toBasket(null, "ME86").items).toEqual([])
	})
})

describe("garage", () => {
	test("машина собирается из полей-объектов и options", async () => {
		const g = (await fixture("garage-cars.json")).data as RawGarage
		const cars = toCars(g.transportList)
		expect(cars).toHaveLength(1) // active "0" не показываем
		const c = cars[0]!
		expect(c.brand).toBe("SKODA")
		expect(c.model).toBe("OCTAVIA")
		expect(c.year).toBe(2012)
		expect(c.modification).toBe("1.8 TSI")
		expect(c.engine).toBe("1798 бензин")
		expect(c.odometer).toBe(184000)
		expect(c.ref.transportId).toBe(111)
	})

	test("пустой гараж — пустой список", async () => {
		const g = (await fixture("garage-empty.json")).data as RawGarage
		expect(toCars(g.transportList)).toEqual([])
	})
})

describe("ссылки", () => {
	test("карточка по алиасу, по artId и уценённая партия", () => {
		expect(productUrl("filtr-55469")).toBe("https://armtek.ru/product/filtr-55469")
		expect(productUrl(undefined, 55469)).toBe("https://armtek.ru/product/55469")
		expect(productUrl("filtr-55469", 55469, "C1")).toBe("https://armtek.ru/product/markdown/filtr-55469/C1")
		expect(productUrl(undefined)).toBeUndefined()
	})

	test("карточка заказа по номеру, иначе по хэшу", () => {
		expect(orderUrl("1234567", "abc")).toBe("https://armtek.ru/profile/orders/card?orderId=1234567")
		expect(orderUrl(undefined, "abc")).toBe("https://armtek.ru/profile/orders/card?orderHash=abc")
		expect(orderUrl(undefined, undefined)).toBe("https://armtek.ru/profile/orders")
	})
})

describe("машина и категории", () => {
	test("идентификатор модификации берётся из любого знакомого поля", () => {
		expect(carTarget({ linkingTargetId: 1 })).toEqual({ linkingTargetId: 1, linkingTargetType: "P" })
		// autodoc зовёт то же самое число modificationId — оба сайта на TecDoc
		expect(carTarget({ modificationId: 58759 })).toEqual({ linkingTargetId: 58759, linkingTargetType: "P" })
		expect(carTarget({ carId: 7, linkingTargetType: "L" })).toEqual({ linkingTargetId: 7, linkingTargetType: "L" })
	})

	test("без числа фильтра нет", () => {
		expect(carTarget(null)).toBeUndefined()
		expect(carTarget({ transportId: "7" })).toBeUndefined()
		expect(carTarget({ modificationId: 0 })).toBeUndefined()
	})

	test("категория выбирается по совпадению слов, а не по порядку", () => {
		const cats = [{ NAME: "Станки для заклепки тормозных колодок" }, { NAME: "Колодки тормозные" }]
		expect(bestCategory(cats, "тормозные колодки")!.NAME).toBe("Колодки тормозные")
		// ничья — за первой: порядок сайта остаётся значимым
		expect(bestCategory([{ NAME: "Свечи зажигания" }, { NAME: "Свечи зажигания" }], "свеча зажигания")!.NAME).toBe("Свечи зажигания")
		expect(bestCategory([], "что угодно")).toBeUndefined()
		// на артикул подсказка тоже отвечает категорией — общих слов нет, значит нет и категории
		expect(bestCategory([{ NAME: "Фильтры масляные" }], "0986452041")).toBeUndefined()
	})
})

describe("toInfo", () => {
	test("цена «от» и склады из строк формы card", async () => {
		const rows: RawCard[] = (await fixture("search-card-bosch.json")).data.articlesData
		const stats: RawReviewRating = (await fixture("reviews-rating.json")).data[0]
		const info = toInfo(rows, stats, TODAY)
		expect(info.article).toBe("0 986 452 041")
		expect(info.brand).toBe("BOSCH")
		expect(info.price).toBe(592)
		expect(info.currency).toBe("RUB")
		expect(info.stock![0]!.code).toBe("MOV0000019")
		expect(info.url).toStartWith("https://armtek.ru/product/")
		expect(info.rating!.histogram).toHaveLength(5)
	})
})

describe("toOrders", () => {
	test("суммы строками, позиции со ссылками", async () => {
		const orders = toOrders((await fixture("orders.json")).data.ORDER)
		expect(orders).toHaveLength(1)
		expect(orders[0]).toMatchObject({ id: "1234567", date: "2026-08-30", status: "В работе", total: 1184, currency: "RUB" })
		expect(orders[0]!.items![0]).toMatchObject({ article: "0 986 452 041", brand: "BOSCH", qty: 2, price: 592, sum: 1184 })
		expect(orders[0]!.extra).toMatchObject({ guid: "abc123" })
	})

	test("пустой список — пустой массив", () => {
		expect(toOrders(undefined)).toEqual([])
	})
})

describe("cleanName", () => {
	test("SAP-разметка в имени становится разделителем", () => {
		expect(cleanName("фильтр масляный!\\ Mazda 626, Mitsubishi Galant 1.8-2.5i 91>"))
			.toBe("фильтр масляный · Mazda 626, Mitsubishi Galant 1.8-2.5i 91>")
		expect(cleanName("прокладка\\\\ VW")).toBe("прокладка · VW")
		// висячий разделитель в конце не нужен
		expect(cleanName("имя!\\")).toBe("имя")
	})

	test("чистое имя не трогается, пустое становится undefined", () => {
		expect(cleanName("Фильтр масляный BOSCH 0 986 452 041")).toBe("Фильтр масляный BOSCH 0 986 452 041")
		expect(cleanName("   ")).toBeUndefined()
		expect(cleanName(undefined)).toBeUndefined()
	})

	test("имя чистится везде: поиск, предложения, корзина", async () => {
		const cart: RawCart = (await fixture("cart-list.json")).data
		expect(toBasket(cart, "ME86", TODAY).items[0]!.name).not.toContain("!\\")
		const rows: RawCard[] = (await fixture("search-card-bosch.json")).data.articlesData
		expect(toInfo(rows, undefined, TODAY).name).not.toContain("!\\")
	})
})

describe("склады у toInfo", () => {
	test("код склада и срок: имени у armtek нет нигде", async () => {
		const rows: RawCard[] = (await fixture("search-card-bosch.json")).data.articlesData
		const stock = toInfo(rows, undefined, TODAY).stock!
		expect(stock[0]!.code).toBe("MOV0000019")
		expect(stock[0]!.name).toBeUndefined()
		expect(stock[0]!.deliveryDays).toBe(0)
	})
})

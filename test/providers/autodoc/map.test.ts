import { describe, expect, test } from "bun:test"
import {
	basketAddBody, bestCategory, cardUrl, carQuery, categoryIds, priceUrl, reviewsUrl, toBasket,
	toBrandHits, toCars, toInfo, toOffers, toOrders, toProducts, toReviews,
} from "../../../src/providers/autodoc/map.ts"

// Фикстуры лежат одним набором в http/: имя файла — метод и путь вызова,
// так их читает и фикстурный режим api.ts. Второй копии этих же ответов
// рядом не держим — она молча разъезжалась бы с первой.
const FILES: Record<string, string> = {
	manufacturers: "GET__api_price-service_search_manufacturers",
	"goods-info": "GET__api_goods-service_goods_info",
	originals: "GET__api_price-service_price-list_originals",
	reviews: "GET__api_goods-service_feedback_messages",
	suggest: "POST__api_catalog-universal-service_catalog-universal-categories_search",
	"find-goods": "POST__api_catalog-universal-service_catalog-universal-goods_find-goods",
	"garage-cars": "GET__api_garage-service_garage_cars",
	"basket-items": "GET__api_basket-service_basket_items",
	"goods-price": "GET__api_goods-service_goods_price",
	orders: "GET__api_order-service_orders_items",
}

const fx = async (n: string) => {
	const file = FILES[n]
	if (!file) throw new Error(`нет фикстуры ${n}`)
	return JSON.parse(await Bun.file(`${import.meta.dir}/../../fixtures/autodoc/http/${file}.json`).text())
}

describe("toBrandHits", () => {
	test("производитель + рейтинг из info", async () => {
		const hits = toBrandHits((await fx("manufacturers")).items, new Map([[657, await fx("goods-info")]]))
		expect(hits).toEqual([{ brand: "VAG", article: "N90954802", name: "Болт", rating: { average: 4.9107, count: 56 },
			images: ["https://images.autodoc.ru/goods/657/N90954802/med.webp"],
			url: "https://www.autodoc.ru/man/657/part/n90954802", extra: { manufacturerId: 657 } }])
	})
})

describe("toOffers", () => {
	test("точные предложения и аналоги, ref для корзины", async () => {
		const offers = toOffers(await fx("originals"), "n90954802", "VAG")
		expect(offers).toHaveLength(3)
		const exact = offers.filter(o => !o.analog)
		expect(exact).toHaveLength(2)
		expect(exact[0]).toMatchObject({
			article: "N 909 548 02", brand: "VAG", name: "Болт", price: 407, currency: "RUB", quantity: 100,
			deliveryDays: 3, deliveryDate: "2026-09-07", seller: "Дилер · Склад дилера",
			rating: { average: 4.9, count: 56 }, url: "https://www.autodoc.ru/price/657/n90954802",
			ref: { priceId: 2670855866, partnerId: 6727, directionToManufacturerId: 544130, article: "n90954802", partName: "Болт",
				priceType: 2, price: 407, deliveryDays: 3, minimalQuantity: 1, hash: "H2", manufacturerId: 657 },
		})
		const analog = offers.find(o => o.analog)!
		expect(analog.brand).toBe("FEBEST")
		expect(analog.analogOf).toEqual({ article: "n90954802", brand: "VAG" })
	})
	test("forceAnalog помечает всё аналогом", async () => {
		expect(toOffers(await fx("originals"), "n90954802", "VAG", true).every(o => o.analog)).toBe(true)
	})
})

describe("search по названию", () => {
	test("categoryIds берёт только категории", async () => {
		expect(categoryIds((await fx("suggest")).items)).toEqual([{ id: 408, title: "Болты" }, { id: 409, title: "Болты крепёжные" }])
	})
	test("toProducts", async () => {
		expect(toProducts((await fx("find-goods")).items, "Болты")[0]).toMatchObject({
			article: "kr013511020", brand: "KRANZ", price: 252, currency: "RUB", quantity: 7, category: "Болты",
		})
		expect(toProducts((await fx("find-goods")).items)[0]!.rating).toBeUndefined() // 0 оценок — нет рейтинга
	})
})

describe("toReviews", () => {
	test("рейтинг из info, гистограмма, выжимка, покупка подтверждена", async () => {
		const r = toReviews(await fx("reviews"), await fx("goods-info"))
		expect(r.total).toBe(35)
		expect(r.rating).toEqual({ average: 4.9107, count: 56, histogram: [54, 1, 0, 0, 1] })
		expect(r.summary).toEqual({ pros: ["Как оригинал.", "Отличное качество."], cons: ["Изогнулся при установке."] })
		expect(r.items[0]).toEqual({ author: "Иван И.", date: "2025-03-01", rating: 5, pros: "крепкий", cons: undefined, text: "хороший товар", purchased: true })
	})
})

describe("toCars", () => {
	test("ref с carId и modificationId", async () => {
		expect(toCars((await fx("garage-cars")).cars, 10)[0]).toEqual({
			brand: "SKODA", model: "OCTAVIA III лифтбек (5E3)", year: 2017, engine: "1.8 TSI", vin: "XXX", odometer: undefined,
			ref: { carId: 10, modificationId: 58759, modelId: 11195, brandName: "SKODA", main: true },
		})
	})
})

describe("basket", () => {
	test("toBasket", async () => {
		const b = toBasket(await fx("basket-items"))
		expect(b.total).toBe(814)
		// артикул, производитель и поставщик приходят вложенными в priceItem
		expect(b.items[0]).toMatchObject({
			id: "555", article: "N 909 548 02", brand: "VAG", price: 407, quantity: 2, sum: 814, deliveryDays: 3,
			seller: "TOT · Оптовый склад", url: "https://www.autodoc.ru/man/657/part/n90954802",
		})
		expect(b.items[0]!.extra).toMatchObject({ priceType: 2, hash: "E1D05586" })
		expect(b.url).toBe("https://www.autodoc.ru/cart")
	})
	test("basketAddBody — форма фронта", () => {
		expect(basketAddBody({ priceId: 1, partnerId: 2, directionToManufacturerId: 3, article: "n1", partName: "Болт", priceType: 2, price: 407, deliveryDays: 3, minimalQuantity: 1, hash: "h", manufacturerId: 657 }, 2))
			.toEqual({ priceId: 1, partnerId: 2, directionToManufacturerId: 3, article: "n1", partName: "Болт", quantity: 2, price: 407, priceType: 2, description: "", deliveryDays: 3 })
	})
})

describe("ссылки", () => {
	test("карточка, отзывы и прайс-лист", () => {
		expect(cardUrl(30, "0986452041")).toBe("https://www.autodoc.ru/man/30/part/0986452041")
		// сайт приводит артикул в адресе к нижнему регистру — и в canonical тоже
		expect(cardUrl(657, "N90954802")).toBe("https://www.autodoc.ru/man/657/part/n90954802")
		expect(reviewsUrl(30, "0986452041")).toBe("https://www.autodoc.ru/man/30/part/0986452041/reviews")
		expect(priceUrl(30, "0986452041")).toBe("https://www.autodoc.ru/price/30/0986452041")
	})
})

describe("поиск с учётом машины", () => {
	test("категория выбирается по совпадению слов, а не по порядку подсказки", () => {
		const cats = [{ id: 1, title: "Станки для заклепки тормозных колодок" }, { id: 2, title: "Колодки тормозные" }]
		expect(bestCategory(cats, "тормозные колодки").id).toBe(2)
		expect(bestCategory([{ id: 1, title: "Фильтры масляные" }], "фильтр масляный").id).toBe(1)
		// ничья — за первой
		expect(bestCategory([{ id: 1, title: "Свечи зажигания" }, { id: 2, title: "Свечи зажигания" }], "свеча зажигания").id).toBe(1)
	})

	test("фильтр включается только при всех трёх параметрах", () => {
		expect(carQuery({ brandName: "SKODA", modelId: 11195, modificationId: 58759 }))
			.toEqual({ BrandName: "SKODA", Model: 11195, ModificationId: 58759 })
		expect(carQuery({ brandName: "SKODA", modificationId: 58759 })).toBeUndefined()
		expect(carQuery({ modelId: 11195, modificationId: 58759 })).toBeUndefined()
		expect(carQuery(null)).toBeUndefined()
	})
})

describe("toInfo", () => {
	test("карточка: рейтинг с гистограммой, цена «от», характеристики", async () => {
		const info = toInfo(await fx("goods-info"), await fx("goods-price"))
		expect(info).toMatchObject({ article: "N90954802", brand: "VAG", name: "Болт", price: 317, currency: "RUB", deliveryDays: 0 })
		expect(info.rating).toEqual({ average: 4.9107, count: 56, histogram: [54, 1, 0, 0, 1] })
		expect(info.url).toBe("https://www.autodoc.ru/man/657/part/n90954802")
		expect(info.stock).toEqual([{ code: "autodoc", name: "на складе", quantity: 4 }])
		expect(info.description).toBe("Резьба: M14x1,5; Длина: 52 мм")
		expect(info.extra).toMatchObject({ manufacturerId: 657, categoryId: 4558 })
	})
})

describe("toOrders", () => {
	test("позиция заказа как заказ: статус, сумма, товар со ссылкой", async () => {
		const orders = toOrders((await fx("orders")).items)
		expect(orders).toHaveLength(2)
		expect(orders[0]).toMatchObject({ id: "185465447", date: "2026-09-01T11:18:18.31", status: "Закуплено", total: 912, currency: "RUB", url: "https://www.autodoc.ru/my/orders" })
		expect(orders[0]!.items![0]).toMatchObject({ article: "n90954802", brand: "VAG", qty: 6, price: 152, sum: 912, url: "https://www.autodoc.ru/man/657/part/n90954802" })
		// «0001-01-01» — пустое значение SAP, а не первый век
		expect(orders[1]!.date).toBe("")
	})
})

import { describe, expect, test } from "bun:test"
import { basketAddBody, categoryIds, toBasket, toBrandHits, toCars, toOffers, toProducts, toReviews } from "../../../src/providers/autodoc/map.ts"

const fx = async (n: string) => JSON.parse(await Bun.file(`${import.meta.dir}/../../fixtures/autodoc/${n}.json`).text())

describe("toBrandHits", () => {
	test("производитель + рейтинг из info", async () => {
		const hits = toBrandHits((await fx("manufacturers")).items, new Map([[657, await fx("goods-info")]]))
		expect(hits).toEqual([{ brand: "VAG", article: "N90954802", name: "Болт", rating: { average: 4.9107, count: 56 },
			images: ["https://images.autodoc.ru/goods/657/N90954802/med.webp"], extra: { manufacturerId: 657 } }])
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
			ref: { carId: 10, modificationId: 58759, main: true },
		})
	})
})

describe("basket", () => {
	test("toBasket", async () => {
		const b = toBasket(await fx("basket-items"))
		expect(b.total).toBe(814)
		expect(b.items[0]).toMatchObject({ id: "555", article: "N 909 548 02", brand: "VAG", price: 407, quantity: 2, sum: 814, deliveryDays: 3 })
		expect(b.items[0]!.extra).toMatchObject({ priceType: 2, hash: "H2" })
	})
	test("basketAddBody — форма фронта", () => {
		expect(basketAddBody({ priceId: 1, partnerId: 2, directionToManufacturerId: 3, article: "n1", partName: "Болт", priceType: 2, price: 407, deliveryDays: 3, minimalQuantity: 1, hash: "h", manufacturerId: 657 }, 2))
			.toEqual({ priceId: 1, partnerId: 2, directionToManufacturerId: 3, article: "n1", partName: "Болт", quantity: 2, price: 407, priceType: 2, description: "", deliveryDays: 3 })
	})
})

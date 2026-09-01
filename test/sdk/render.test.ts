import { describe, expect, test } from "bun:test"
import { days, isoDate, renderBasket, renderOffers, renderReviews, table } from "../../src/sdk/render.ts"

// цвета гаснут вне TTY, так что строки сравниваются напрямую

describe("days", () => {
	test("склонение", () => {
		expect(days(0)).toBe("сегодня")
		expect(days(1)).toBe("1 день")
		expect(days(3)).toBe("3 дня")
		expect(days(11)).toBe("11 дней")
		expect(days(undefined)).toBe("—")
	})
})

describe("isoDate", () => {
	test("режет время", () => {
		expect(isoDate("2026-09-04T00:00:00")).toBe("2026-09-04")
		expect(isoDate(undefined)).toBeUndefined()
	})
})

describe("table", () => {
	test("выравнивает и обрезает хвост", () => {
		expect(table([["a", "bb"], ["ccc", "d"]], ["X", "Y"])).toBe("X    Y\na    bb\nccc  d")
	})
})

describe("renderOffers", () => {
	test("одна строка на предложение, аналог помечен", () => {
		const out = renderOffers([
			{ article: "N1", brand: "VAG", name: "Болт", price: 407, currency: "RUB", quantity: 100, deliveryDays: 3, seller: "Дилер" },
			{ article: "X2", brand: "FEBEST", name: "Болты", price: 916, currency: "RUB", deliveryDays: 2, analog: true },
		])
		const lines = out.split("\n")
		expect(lines[0]).toContain("БРЕНД")
		expect(lines[1]).toContain("407 ₽")
		expect(lines[1]).toContain("100 шт")
		expect(lines[1]).toContain("3 дня")
		expect(lines[2]).toContain("аналог")
	})
	test("пусто — заглушка", () => {
		expect(renderOffers([])).toBe("предложений нет")
	})
})

describe("renderBasket", () => {
	test("сумма и итог", () => {
		const out = renderBasket({ currency: "RUB", total: 814, items: [
			{ id: "1", article: "N1", brand: "VAG", price: 407, quantity: 2, sum: 814 },
		] })
		expect(out).toContain("814 ₽")
		expect(out).toContain("итого")
	})
})

describe("renderReviews", () => {
	test("выжимка и лента", () => {
		const out = renderReviews({ total: 1, rating: { average: 4.9, count: 56 },
			summary: { pros: ["Как оригинал."], cons: [] },
			items: [{ author: "Юрий Л.", rating: 5, text: "хороший товар", purchased: true }] })
		expect(out).toContain("отзывов: 1")
		expect(out).toContain("+ Как оригинал.")
		expect(out).toContain("хороший товар")
	})
})

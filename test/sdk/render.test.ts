// Цвет решается на каждый вызов, поэтому под pty (bun test в терминале)
// stdout — это TTY и escape-последовательности были бы включены. NO_COLOR
// гасит их одинаково и в пайпе, и в терминале, так что строки сравниваются
// напрямую.
process.env.NO_COLOR = "1"

import { describe, expect, test } from "bun:test"
import { days, isoDate, renderBasket, renderBrands, renderInfo, renderOffers, renderOrders, renderProducts, renderReviews, table } from "../../src/sdk/render.ts"

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

describe("дополнительные колонки", () => {
	test("встают слева и в шапке, и в строке", () => {
		const out = renderOffers(
			[{ article: "N1", brand: "VAG", price: 407, currency: "RUB" as const, provider: "beta" }],
			[{ head: "ПРОВАЙДЕР", cell: o => o.provider }],
		)
		const lines = out.split("\n")
		expect(lines[0]!.startsWith("ПРОВАЙДЕР")).toBe(true)
		expect(lines[1]!.startsWith("beta")).toBe(true)
		expect(lines[1]).toContain("407 ₽")
	})

	test("from сдвигает нумерацию строк", () => {
		const out = renderOffers([{ article: "N1", brand: "VAG", price: 1, currency: "RUB" as const }], [], 5)
		expect(out.split("\n")[1]!.startsWith("5")).toBe(true)
	})

	test("без колонок вывод прежний", () => {
		const one = { article: "N1", brand: "VAG", price: 1, currency: "RUB" as const }
		expect(renderOffers([one])).toBe(renderOffers([one], []))
	})
})

describe("ссылки в таблицах", () => {
	test("поиск и бренды показывают адрес строкой", () => {
		expect(renderProducts([{ article: "N1", brand: "VAG", name: "Болт", url: "https://x/1" }])).toContain("https://x/1")
		expect(renderBrands([{ brand: "VAG", article: "N1", url: "https://x/1" }])).toContain("ССЫЛКА")
	})

	test("повторный адрес у предложений печатается один раз", () => {
		const o = (price: number, url: string) => ({ article: "N1", brand: "VAG", price, currency: "RUB" as const, url })
		const lines = renderOffers([o(1, "https://x/1"), o(2, "https://x/1"), o(3, "https://x/2")]).split("\n")
		expect(lines[1]).toContain("https://x/1")
		expect(lines[2]).not.toContain("https://x/1")
		expect(lines[3]).toContain("https://x/2")
	})

	test("корзина печатает адрес корзины под итогом", () => {
		const out = renderBasket({ items: [{ id: "1", article: "N1", brand: "VAG", price: 1, quantity: 1, url: "https://x/1" }], currency: "RUB", url: "https://x/cart" })
		expect(out).toContain("https://x/1")
		expect(out).toContain("https://x/cart")
	})

	test("страница отзывов идёт после гистограммы", () => {
		const out = renderReviews({ total: 1, items: [{ text: "ок" }], url: "https://x/1/reviews" })
		expect(out).toContain("https://x/1/reviews")
	})
})

describe("renderInfo", () => {
	test("карточка: звёзды, гистограмма, цена, склады, описание и адрес", () => {
		const out = renderInfo({
			article: "N1", brand: "VAG", name: "Болт",
			rating: { average: 4.91, count: 56, histogram: [54, 1, 0, 0, 1] },
			price: 317, currency: "RUB", deliveryDays: 3,
			stock: [{ code: "S1", name: "склад", quantity: 4 }],
			description: "Резьба: M14x1,5", url: "https://x/1",
		})
		expect(out).toContain("Болт")
		expect(out).toContain("4.91")
		expect(out).toContain("5★")
		expect(out).toContain("317 ₽")
		expect(out).toContain("3 дня")
		expect(out).toContain("склад")
		expect(out).toContain("Резьба")
		expect(out).toContain("https://x/1")
		// код склада человеку не нужен — он остаётся в --json
		expect(out).not.toContain("S1")
	})

	test("без оценок и без цены карточка всё равно рисуется", () => {
		const out = renderInfo({ article: "N1", brand: "VAG", name: "Болт" })
		expect(out).toContain("нет оценок")
		expect(out).not.toContain("Цена и срок")
		expect(out).not.toContain("Наличие")
	})
})

describe("renderOrders", () => {
	test("шапка заказа, позиции таблицей, повторный адрес один раз", () => {
		const order = (id: string) => ({
			id, date: "2026-09-01T11:18:18.31", status: "Закуплено", total: 912, currency: "RUB",
			url: "https://x/orders",
			items: [{ article: "N1", brand: "VAG", name: "Болт", qty: 6, price: 152, sum: 912, url: "https://x/1" }],
		})
		const lines = renderOrders([order("1"), order("2")]).split("\n")
		expect(lines[0]).toContain("№ 1")
		expect(lines[0]).toContain("2026-09-01")
		expect(lines[0]).toContain("https://x/orders")
		expect(lines[1]).toContain("Болт")
		expect(lines[2]).not.toContain("https://x/orders")
	})

	test("дата-пустышка не рисуется годом", () => {
		expect(renderOrders([{ id: "1", date: "", status: "ок", total: 1, currency: "RUB" }])).toContain("—")
	})

	test("пусто — это не ошибка", () => {
		expect(renderOrders([])).toBe("заказов нет")
	})
})

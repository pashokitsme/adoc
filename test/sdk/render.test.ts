// Цвет и ссылки решаются на каждый вызов, поэтому под pty (bun test в
// терминале) stdout — это TTY, и escape-последовательности были бы включены.
// NO_COLOR гасит цвет одинаково и в пайпе, и в терминале, ADOC_LINKS=list
// оставляет адреса списком под таблицей: строки сравниваются напрямую.
// Режим osc8 проверяется отдельно, в своём describe.
process.env.NO_COLOR = "1"
process.env.ADOC_LINKS = "list"

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { LINKS_HINT, days, hyperlink, isoDate, linksHint, linksMode, renderBasket, renderBrands, renderInfo, renderOffers, renderOrders, renderProducts, renderReviews, table } from "../../src/sdk/render.ts"

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
	test("встают после номера строки, и в шапке, и в строке", () => {
		const out = renderOffers(
			[{ article: "N1", brand: "VAG", price: 407, currency: "RUB" as const, provider: "beta" }],
			[{ head: "ПРОВАЙДЕР", cell: o => o.provider }],
		)
		const lines = out.split("\n")
		// номер первый: он ключ к списку адресов под таблицей
		expect(lines[0]!.startsWith("#  ПРОВАЙДЕР")).toBe(true)
		expect(lines[1]!.startsWith("1  beta")).toBe(true)
		expect(lines[1]).toContain("407 ₽")
	})

	test("номер остаётся первым и у поиска, брендов и корзины", () => {
		const col = [{ head: "ГДЕ", cell: () => "beta" }]
		expect(renderProducts([{ article: "N1", brand: "VAG", name: "Болт" }], col).split("\n")[0]).toStartWith("#  ГДЕ")
		expect(renderBrands([{ brand: "VAG", article: "N1" }], col).split("\n")[0]).toStartWith("#  ГДЕ")
		const basket = renderBasket({ items: [{ id: "7", article: "N1", brand: "VAG", price: 1, quantity: 1 }], currency: "RUB" }, col)
		expect(basket.split("\n")[0]).toStartWith("#  ГДЕ")
		expect(basket.split("\n")[1]).toStartWith("1  beta")
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

describe("ссылка колонкой", () => {
	test("адрес строки стоит в её же строке, последней колонкой", () => {
		const out = renderProducts([
			{ article: "N1", brand: "VAG", name: "Болт", url: "https://x/1" },
			{ article: "N2", brand: "VAG", name: "Гайка" },
			{ article: "N3", brand: "VAG", name: "Шайба", url: "https://x/3" },
		])
		const lines = out.split("\n")
		expect(lines[0]).toContain("ССЫЛКА")
		expect(lines[1]).toContain("https://x/1")
		// строке без адреса приписывать нечего
		expect(lines[2]).not.toContain("https://")
		expect(lines[3]).toContain("https://x/3")
		// списка под таблицей больше нет: строк ровно шапка и три товара
		expect(lines).toHaveLength(4)
	})

	test("адрес не режется: обрезанный не открыть", () => {
		const long = "https://armtek.ru/product/filtr-maslyanyy-bosch-0-986-452-041-mazda-626-mitsubishi-galant-18-25i-91-55469"
		const out = renderProducts([{ article: "0 986 452 041", brand: "BOSCH", name: "Фильтр масляный", price: 592, url: long }])
		expect(out).toContain(long)
	})

	test("склеенная строка отдаёт все свои адреса через пробел", () => {
		const out = renderProducts([
			{ article: "N1", brand: "VAG", name: "Болт", url: "https://a/1", urls: { alpha: "https://a/1", beta: "https://b/1" } },
		])
		expect(out).toContain("https://a/1 https://b/1")
		// свой адрес не повторяется дважды
		expect(out.split("https://a/1").length - 1).toBe(1)
	})

	test("бренды, предложения и корзина — та же колонка", () => {
		expect(renderBrands([{ brand: "VAG", article: "N1", url: "https://x/1" }])).toContain("https://x/1")
		expect(renderOffers([{ article: "N1", brand: "VAG", price: 1, currency: "RUB", url: "https://x/o" }])).toContain("https://x/o")
		const cart = renderBasket({ items: [{ id: "1", article: "N1", brand: "VAG", price: 1, quantity: 1, url: "https://x/1" }], currency: "RUB", url: "https://x/cart" })
		expect(cart.split("\n")[1]).toContain("https://x/1")
		// адрес самой корзины остаётся у итога
		expect(cart.split("\n").at(-1)).toContain("https://x/cart")
	})

	test("страница отзывов — в первой строке", () => {
		const out = renderReviews({ total: 1, items: [{ text: "ок" }], url: "https://x/1/reviews" })
		expect(out.split("\n")[0]).toContain("https://x/1/reviews")
	})
})

describe("renderInfo", () => {
	test("карточка: звёзды, гистограмма, цена, склады, описание и адрес в шапке", () => {
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
		expect(out.split("\n")[1]).toContain("https://x/1")
		// имя склада есть — код в таблице не нужен, он остаётся в --json
		expect(out).not.toContain("S1")
	})

	test("склад без имени показан кодом и сроком", () => {
		const out = renderInfo({
			article: "N1", brand: "BOSCH", name: "Фильтр",
			stock: [{ code: "MOV0000019", quantity: 20, deliveryDays: 0 }],
		})
		expect(out).toContain("MOV0000019")
		expect(out).toContain("сегодня")
	})

	test("без оценок и без цены карточка всё равно рисуется", () => {
		const out = renderInfo({ article: "N1", brand: "VAG", name: "Болт" })
		expect(out).toContain("нет оценок")
		expect(out).not.toContain("Цена и срок")
		expect(out).not.toContain("Наличие")
	})
})

describe("renderOrders", () => {
	test("общий адрес — заголовком, позиции таблицей со своей колонкой адреса", () => {
		const order = (id: string) => ({
			id, date: "2026-09-01T11:18:18.31", status: "Закуплено", total: 912, currency: "RUB",
			url: "https://x/orders",
			items: [{ article: "N1", brand: "VAG", name: "Болт", qty: 6, price: 152, sum: 912, url: "https://x/1" }],
		})
		const out = renderOrders([order("1"), order("2")])
		const lines = out.split("\n")
		// адрес списка заказов один на всех — он в заголовке блока и не повторяется
		expect(lines[0]).toBe("https://x/orders")
		expect(out.split("https://x/orders").length - 1).toBe(1)
		expect(lines[1]).toContain("№ 1 · 2026-09-01 · Закуплено · 912 ₽")
		// шапка колонок — у каждого заказа своя, но ширины общие на весь список
		expect(lines[2]).toContain("АРТИКУЛ")
		expect(lines[3]).toContain("Болт")
		expect(lines[3]).toContain("https://x/1")
		// между заказами ровно одна пустая строка, внутри заказа — ни одной
		expect(lines[4]).toBe("")
		expect(lines[5]).toContain("№ 2")
		expect(lines.filter(l => l === "").length).toBe(1)
	})

	test("колонки позиций общие на все заказы сайта", () => {
		const out = renderOrders([
			{ id: "1", date: "2026-09-01", status: "ок", total: 1, currency: "RUB",
				items: [{ article: "N1", brand: "VAG", name: "Болт", qty: 1, price: 1 }] },
			{ id: "2", date: "2026-09-01", status: "ок", total: 1, currency: "RUB",
				items: [{ article: "N-длинный-артикул", brand: "VAG", name: "Гайка", qty: 1, price: 1 }] },
		])
		const rows = out.split("\n").filter(l => l.includes("Болт") || l.includes("Гайка"))
		// одна и та же колонка «БРЕНД» в обоих заказах начинается на одном месте
		expect(rows.map(l => l.indexOf("VAG"))).toEqual([rows[1]!.indexOf("VAG"), rows[1]!.indexOf("VAG")])
	})

	test("у каждого заказа свой адрес — он остаётся в шапке заказа", () => {
		const out = renderOrders([
			{ id: "1", date: "2026-09-01", status: "ок", total: 1, currency: "RUB", url: "https://x/o/1" },
			{ id: "2", date: "2026-09-01", status: "ок", total: 1, currency: "RUB", url: "https://x/o/2" },
		])
		expect(out).toContain("https://x/o/1")
		expect(out).toContain("https://x/o/2")
	})

	test("дата-пустышка не рисуется годом", () => {
		expect(renderOrders([{ id: "1", date: "", status: "ок", total: 1, currency: "RUB" }])).toContain("—")
	})

	test("пусто — это не ошибка", () => {
		expect(renderOrders([])).toBe("заказов нет")
	})
})

// Переменные окружения и isTTY — глобальные на процесс: сохраняем и ставим
// назад, иначе следующий файл тестов увидит чужой терминал.
describe("linksMode", () => {
	const KEYS = ["ADOC_LINKS", "TERM_PROGRAM", "TERM", "KITTY_WINDOW_ID", "WT_SESSION", "VTE_VERSION", "KONSOLE_VERSION", "NO_COLOR"] as const
	let saved: (readonly [string, string | undefined])[]
	let tty: unknown

	beforeEach(() => {
		saved = KEYS.map(k => [k, process.env[k]] as const)
		for (const k of KEYS) delete process.env[k]
		tty = process.stdout.isTTY
	})
	afterEach(() => {
		for (const [k, v] of saved) {
			if (v === undefined) delete process.env[k]
			else process.env[k] = v
		}
		;(process.stdout as unknown as { isTTY: unknown }).isTTY = tty
	})

	const mode = (env: Record<string, string>, isTTY: boolean): string => {
		for (const k of KEYS) delete process.env[k]
		Object.assign(process.env, env)
		;(process.stdout as unknown as { isTTY: unknown }).isTTY = isTTY
		return linksMode()
	}

	test("ADOC_LINKS сильнее всего, мусор в ней не считается", () => {
		expect(mode({ ADOC_LINKS: "off", TERM_PROGRAM: "iTerm.app" }, true)).toBe("off")
		expect(mode({ ADOC_LINKS: "list", TERM_PROGRAM: "iTerm.app" }, true)).toBe("list")
		// труба и незнакомый терминал — osc8 всё равно, раз попросили явно
		expect(mode({ ADOC_LINKS: "osc8" }, false)).toBe("osc8")
		expect(mode({ ADOC_LINKS: "да", TERM_PROGRAM: "iTerm.app" }, true)).toBe("osc8")
	})

	test("знакомый терминал в TTY — osc8", () => {
		for (const p of ["iTerm.app", "WezTerm", "vscode", "ghostty", "Hyper", "alacritty", "WarpTerminal", "Tabby", "rio"]) {
			expect(mode({ TERM_PROGRAM: p }, true)).toBe("osc8")
		}
		expect(mode({ TERM: "xterm-kitty" }, true)).toBe("osc8")
		expect(mode({ KITTY_WINDOW_ID: "1" }, true)).toBe("osc8")
		expect(mode({ WT_SESSION: "…" }, true)).toBe("osc8")
		expect(mode({ VTE_VERSION: "5000" }, true)).toBe("osc8")
		expect(mode({ KONSOLE_VERSION: "220400" }, true)).toBe("osc8")
	})

	test("незнакомый терминал, старая VTE и труба — list", () => {
		expect(mode({ TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-256color" }, true)).toBe("list")
		expect(mode({ VTE_VERSION: "4600" }, true)).toBe("list")
		expect(mode({}, true)).toBe("list")
		// труба: `| grep` и агенты обязаны видеть голый адрес
		expect(mode({ TERM_PROGRAM: "iTerm.app" }, false)).toBe("list")
	})

	test("NO_COLOR ссылок не касается", () => {
		expect(mode({ NO_COLOR: "1", TERM_PROGRAM: "iTerm.app" }, true)).toBe("osc8")
	})
})

describe("ссылки в тексте (osc8)", () => {
	const OSC8 = /\x1b\]8;;[^\x07\x1b]*(\x1b\\|\x07)/g
	const strip = (s: string): string => s.replace(OSC8, "")
	const osc8 = <T>(f: () => T): T => {
		process.env.ADOC_LINKS = "osc8"
		try { return f() } finally { process.env.ADOC_LINKS = "list" }
	}

	test("ширина колонки считается без адреса", () => {
		const cell = hyperlink("a", "https://x/очень/длинный/адрес")
		expect(osc8(() => table([[cell, "bb"], ["ccc", "d"]]))).toBe(`${cell}    bb\nccc  d`)
	})

	test("адрес вшит в номер, артикул и название, списка под таблицей нет", () => {
		const out = osc8(() => renderProducts([{ article: "N1", brand: "VAG", name: "Болт", url: "https://x/1" }]))
		expect(out).toContain(hyperlink("Болт", "https://x/1"))
		expect(out).toContain(hyperlink("1", "https://x/1"))
		expect(out).toContain(hyperlink("N1", "https://x/1"))
		// на экране адреса нет вовсе: он только внутри escape
		expect(strip(out)).not.toContain("https://")
	})

	test("те же строки, что в списке, только без колонки адреса", () => {
		const items = [
			{ article: "N1", brand: "VAG", name: "Болт", price: 407, url: "https://x/1" },
			{ article: "N2", brand: "VAG", name: "Гайка" },
		]
		// в osc8 колонки ССЫЛКА нет вовсе: адрес вшит в текст строки
		const inline = strip(osc8(() => renderProducts(items)))
		expect(inline).not.toContain("ССЫЛКА")
		expect(inline.split("\n")).toHaveLength(3)
		expect(renderProducts(items)).toContain("ССЫЛКА")
	})

	test("артикул кликается везде, где он есть колонкой", () => {
		expect(osc8(() => renderBrands([{ brand: "VAG", article: "N1", url: "https://x/b" }])))
			.toContain(hyperlink("N1", "https://x/b"))
		expect(osc8(() => renderBasket({ currency: "RUB", items: [{ id: "1", article: "N1", brand: "VAG", price: 1, quantity: 1, url: "https://x/i" }] })))
			.toContain(hyperlink("N1", "https://x/i"))
		expect(osc8(() => renderOrders([{
			id: "1", date: "2026-09-01", status: "ок", total: 1, currency: "RUB",
			items: [{ article: "N1", brand: "VAG", name: "Болт", qty: 1, price: 1, url: "https://x/p" }],
		}]))).toContain(hyperlink("N1", "https://x/p"))
	})

	test("подсказка про клик — только под выводом со вшитой ссылкой", () => {
		const out = osc8(() => renderProducts([{ article: "N1", brand: "VAG", name: "Болт", url: "https://x/1" }]))
		expect(osc8(() => linksHint(out))).toContain(LINKS_HINT)
		// нечего кликать — не о чем и подсказывать
		expect(osc8(() => linksHint("просто таблица"))).toBe("")
		// в списке адресов подсказка не нужна: адрес и так виден целиком
		expect(linksHint(out)).toBe("")
	})

	test("бренд, предложение и позиция корзины кликаются", () => {
		expect(osc8(() => renderBrands([{ brand: "VAG", article: "N1", url: "https://x/b" }])))
			.toContain(hyperlink("VAG", "https://x/b"))
		expect(osc8(() => renderOffers([{ article: "N1", brand: "VAG", name: "Болт", price: 1, currency: "RUB", url: "https://x/o" }])))
			.toContain(hyperlink("Болт", "https://x/o"))
		expect(osc8(() => renderBasket({ currency: "RUB", items: [{ id: "1", article: "N1", brand: "VAG", name: "Болт", price: 1, quantity: 1, url: "https://x/i" }] })))
			.toContain(hyperlink("Болт", "https://x/i"))
	})

	test("адрес целой страницы прячется в слово", () => {
		expect(osc8(() => renderBasket({ currency: "RUB", url: "https://x/cart", items: [{ id: "1", article: "N1", brand: "VAG", price: 1, quantity: 1 }] })))
			.toContain(hyperlink("корзина", "https://x/cart"))
		expect(osc8(() => renderReviews({ total: 1, items: [{ text: "ок" }], url: "https://x/r" })))
			.toContain(hyperlink("отзывы", "https://x/r"))
		expect(osc8(() => renderInfo({ article: "N1", brand: "VAG", name: "Болт", url: "https://x/1" })))
			.toContain(hyperlink("карточка на сайте", "https://x/1"))
		expect(osc8(() => renderOrders([{ id: "1", date: "2026-09-01", status: "ок", total: 1, currency: "RUB", url: "https://x/orders" }])))
			.toContain(hyperlink("заказы", "https://x/orders"))
	})
})

describe("ссылки выключены (off)", () => {
	const off = <T>(f: () => T): T => {
		process.env.ADOC_LINKS = "off"
		try { return f() } finally { process.env.ADOC_LINKS = "list" }
	}

	test("ни списка, ни escape, ни адреса страницы", () => {
		const out = off(() => renderProducts([{ article: "N1", brand: "VAG", name: "Болт", url: "https://x/1" }]))
		expect(out).not.toContain("https://")
		expect(out).not.toContain("\x1b]8")
		expect(off(() => renderInfo({ article: "N1", brand: "VAG", name: "Болт", url: "https://x/1" }))).not.toContain("https://")
	})
})

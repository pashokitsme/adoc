// render.ts — вывод в терминал. Цвета гаснут вне TTY и при NO_COLOR,
// чтобы `adoc ... | grep` не ловил escape-последовательности.

import type { Basket, BasketItem, BrandHit, Car, Display, Info, Offer, Order, Product, Reviews } from "./contract.ts"

// Решение принимается на каждый вызов, а не один раз при импорте: модуль
// грузится раньше, чем становится известно, куда пойдёт вывод, и запомненное
// значение делало бы NO_COLOR и перенаправление stdout невидимыми.
const plain = (): boolean => !process.stdout.isTTY || !!process.env.NO_COLOR
const wrap = (code: string) => (s: string) => (plain() ? s : `\x1b[${code}m${s}\x1b[0m`)

export const bold = wrap("1")
export const dim = wrap("2")
export const red = wrap("31")
export const green = wrap("32")
export const yellow = wrap("33")
export const cyan = wrap("36")

export const money = (v: number | undefined | null) =>
	v == null ? "—" : `${v.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`

export function days(n: number | undefined | null): string {
	if (n == null) return "—"
	if (n === 0) return "сегодня"
	const last = n % 10, tens = n % 100
	const word = last === 1 && tens !== 11 ? "день"
		: last >= 2 && last <= 4 && (tens < 12 || tens > 14) ? "дня" : "дней"
	return `${n} ${word}`
}

/** Звёзды с половинками: 4.91 → ★★★★★ */
export function stars(avg: number | undefined): string {
	if (!avg) return dim("нет оценок")
	// шкала пятибалльная, но данные приходят из чужого API — без зажима
	// average > 5 даёт repeat(-1) и RangeError вместо карточки
	const full = Math.min(5, Math.max(0, Math.round(avg)))
	return yellow("★".repeat(full) + dim("☆".repeat(5 - full)))
}

export function bar(counts: number[] | undefined, width = 18): string[] {
	if (!counts?.length) return []
	const max = Math.max(...counts, 1)
	return counts.map((c, i) => {
		const filled = Math.round((c / max) * width)
		return `  ${5 - i}★ ${cyan("█".repeat(filled))}${dim("·".repeat(width - filled))} ${String(c).padStart(4)}`
	})
}

/** Ширина без escape-последовательностей — иначе колонки разъезжаются. */
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length

export function table(rows: string[][], head?: string[]): string {
	const all = head ? [head, ...rows] : rows
	if (!all.length) return ""
	const cols = Math.max(...all.map(r => r.length))
	const width: number[] = []
	for (let c = 0; c < cols; c++) width[c] = Math.max(...all.map(r => visible(r[c] ?? "")))
	const line = (r: string[]) =>
		r.map((cell, c) => cell + " ".repeat(Math.max(0, (width[c] ?? 0) - visible(cell))))
			.join("  ").trimEnd()
	const out = rows.map(line)
	return head ? [dim(line(head)), ...out].join("\n") : out.join("\n")
}

/** Мягкий перенос по словам — для текста отзывов. */
export function fold(text: string, width = 76, indent = "  "): string {
	const words = text.replace(/\s+/g, " ").trim().split(" ")
	const lines: string[] = []
	let cur = ""
	for (const w of words) {
		if (cur && cur.length + 1 + w.length > width) { lines.push(cur); cur = w }
		else cur = cur ? `${cur} ${w}` : w
	}
	if (cur) lines.push(cur)
	return lines.map(l => indent + l).join("\n")
}

export const heading = (s: string) => `\n${bold(s)}`

/** Пары «поле — значение» с выровненной колонкой. */
export function fields(rows: [string, string][], indent = "  "): string {
	if (!rows.length) return ""
	const w = Math.max(...rows.map(r => r[0].length))
	return rows.map(([k, v]) => `${indent}${dim(k.padEnd(w))}  ${v}`).join("\n")
}

export const isoDate = (s: string | undefined): string | undefined => s?.slice(0, 10)

/**
 * Дополнительная колонка вызывающего: встаёт слева от таблицы. Так агрегатор
 * добавляет «ПРОВАЙДЕР», «ГДЕ» и «ID» к тем же самым таблицам, вместо того
 * чтобы писать пятую почти дословную копию рендера.
 */
export type Col<T> = { head: string; cell: (item: T) => string }

const heads = <T>(cols: Col<T>[], own: string[]): string[] => [...cols.map(c => c.head), ...own]
const cells = <T>(cols: Col<T>[], item: T, own: string[]): string[] => [...cols.map(c => c.cell(item)), ...own]

export const ratingCell = (r: { average: number; count: number } | undefined) =>
	r && r.count ? `${r.average.toFixed(1)}★ (${r.count})` : dim("—")

export const qtyCell = (q: number | undefined) => (q ? green(`${q} шт`) : dim("нет"))

export function renderProducts<T extends Product>(items: T[], cols: Col<T>[] = []): string {
	if (!items.length) return "ничего не найдено"
	return table(items.map((p, i) => cells(cols, p, [
		String(i + 1), cyan(p.article), bold(p.brand), p.name.slice(0, 50),
		money(p.price), qtyCell(p.quantity), ratingCell(p.rating),
	])), heads(cols, ["#", "АРТИКУЛ", "БРЕНД", "НАЗВАНИЕ", "ОТ", "НАЛИЧИЕ", "РЕЙТИНГ"]))
		+ urlList(items)
}

export function renderBrands<T extends BrandHit>(items: T[], cols: Col<T>[] = []): string {
	if (!items.length) return "не найдено"
	// имя режется: у armtek в него уезжает применимость целиком
	return table(items.map((b, i) => cells(cols, b, [
		String(i + 1), bold(b.brand), cyan(b.article), (b.name ?? "").slice(0, 50), ratingCell(b.rating),
	])), heads(cols, ["#", "БРЕНД", "АРТИКУЛ", "НАЗВАНИЕ", "РЕЙТИНГ"]))
		+ urlList(items)
}

/** Адрес в заголовке блока: корзина, страница отзывов, карточка, список заказов. */
export const link = (url: string | undefined): string => (url ? dim(url) : "")

/**
 * Ссылки строк — списком под таблицей, а не колонкой в ней. Адреса у обоих
 * сайтов доходят до сотни символов, и колонка с ними растягивала строку до
 * двухсот: таблица переставала читаться совсем. Номер здесь тот же, что в
 * колонке «#», так что строку и её адрес видно рядом.
 *
 * Повторный адрес печатается один раз: у десятка предложений одной детали
 * карточка одна.
 */
export function urlList(items: { url?: string }[], from = 1): string {
	const seen = new Set<string>()
	const rows: string[][] = []
	for (const [i, it] of items.entries()) {
		if (!it.url || seen.has(it.url)) continue
		seen.add(it.url)
		rows.push([String(from + i), dim(it.url)])
	}
	return rows.length ? "\n" + table(rows) : ""
}

/**
 * `from` — номер первой строки: у блока аналогов нумерация продолжает основную.
 *
 * Адреса идут списком под таблицей: в строке им места нет.
 */
export function renderOffers<T extends Offer>(items: T[], cols: Col<T>[] = [], from = 1): string {
	if (!items.length) return "предложений нет"
	return table(items.map((o, i) => cells(cols, o, [
		// длины подобраны так, чтобы строка укладывалась в ~110 символов: у
		// autodoc продавец бывает «Магазин CHEB · Наличие в магазине», а имя
		// детали у armtek тянет за собой всю применимость
		String(from + i), bold(o.brand), (o.name ?? "").slice(0, 32), money(o.price), qtyCell(o.quantity),
		o.deliveryDays != null ? days(o.deliveryDays) : (o.deliveryDate ?? dim("—")),
		(o.seller ?? "").slice(0, 26) || dim("—"), ratingCell(o.rating), o.analog ? yellow("аналог") : "",
	])), heads(cols, ["#", "БРЕНД", "НАЗВАНИЕ", "ЦЕНА", "НАЛИЧИЕ", "СРОК", "ПРОДАВЕЦ", "РЕЙТИНГ", ""]))
		+ urlList(items, from)
}

export function renderReviews(r: Reviews): string {
	const out: string[] = [`${dim(`отзывов: ${r.total}`)}${r.url ? `  ${link(r.url)}` : ""}`]
	if (r.rating) out.push(`${stars(r.rating.average)}  ${bold(r.rating.average.toFixed(2))}  ${dim(`${r.rating.count} оценок`)}`)
	for (const l of bar(r.rating?.histogram)) out.push(l)
	if (r.summary && (r.summary.pros.length || r.summary.cons.length)) {
		out.push(heading("Выжимка"))
		for (const p of r.summary.pros) out.push(`  ${green("+")} ${p}`)
		for (const c of r.summary.cons) out.push(`  ${red("−")} ${c}`)
	}
	for (const it of r.items) {
		const who = [it.author, it.purchased ? "покупка подтверждена" : ""].filter(Boolean).join(" · ")
		out.push(heading(`${it.rating ? stars(it.rating) + "  " : ""}${who || "аноним"}`) + (it.date ? dim(`  ${it.date}`) : "") + (it.url ? dim(`  ${it.url}`) : ""))
		if (it.pros) out.push(`  ${green("+")} ${it.pros}`)
		if (it.cons) out.push(`  ${red("−")} ${it.cons}`)
		if (it.text) out.push(fold(it.text))
	}
	return out.join("\n")
}

/** Сумма как её считает сайт; если он её не считает — складываем сами. */
export const basketTotal = (b: Basket): number =>
	b.total ?? b.items.reduce((s, it) => s + (it.sum ?? it.price * it.quantity), 0)

export function renderBasket(b: Basket, cols: Col<BasketItem>[] = []): string {
	if (!b.items.length) return "корзина пуста"
	const rows = b.items.map((it, i) => cells(cols, it, [
		`${i + 1}`, dim(it.id), cyan(it.article), bold(it.brand), (it.name ?? "").slice(0, 36),
		money(it.price), `${it.quantity}`, money(it.sum ?? it.price * it.quantity),
		it.deliveryDays != null ? days(it.deliveryDays) : (it.deliveryDate ?? dim("—")),
	]))
	return table(rows, heads(cols, ["#", "ID", "АРТИКУЛ", "БРЕНД", "НАЗВАНИЕ", "ЦЕНА", "КОЛ", "СУММА", "СРОК"])) +
		urlList(b.items) +
		`\n${dim("итого")}  ${bold(money(basketTotal(b)))}${b.url ? `  ${link(b.url)}` : ""}`
}

/**
 * Карточка товара. Порядок блоков тот же, что у сайта: название, оценки,
 * цена и наличие, характеристики — и ссылка последней строкой, чтобы её было
 * видно, не листая склады.
 */
export function renderInfo(i: Info): string {
	const out: string[] = [`${bold(i.name)}  ${cyan(i.article)}  ${i.brand}${i.url ? `\n${link(i.url)}` : ""}`]

	out.push(heading("Оценки"))
	out.push(`  ${stars(i.rating?.average)}  ${bold(i.rating ? i.rating.average.toFixed(2) : "—")}  ${dim(`${i.rating?.count ?? 0} оценок`)}`)
	out.push(...bar(i.rating?.histogram))

	const price: [string, string][] = []
	if (i.price !== undefined) price.push(["цена от", bold(money(i.price))])
	if (i.deliveryDays !== undefined) price.push(["срок", days(i.deliveryDays)])
	if (price.length) {
		out.push(heading("Цена и срок"))
		out.push(fields(price))
	}

	// Название склада есть не у всех сайтов (у armtek его нет нигде — проверено),
	// и тогда виден код. Срок рядом с остатком: у сайта со многими складами он и
	// отличает строки друг от друга.
	if (i.stock?.length) {
		out.push(heading("Наличие"))
		out.push(table(i.stock.map(s => [
			"  " + (s.name ?? dim(s.code)), qtyCell(s.quantity),
			s.deliveryDays != null ? days(s.deliveryDays) : "",
		])))
	}

	if (i.description) {
		out.push(heading("Описание"))
		out.push(fold(i.description))
	}

	return out.join("\n")
}

/**
 * Заказы: шапка строкой, позиции — таблицей под ней, адреса позиций — списком
 * под таблицей. Общий адрес (у сайта без страницы отдельного заказа он один на
 * весь список) уходит в заголовок блока и у строк не повторяется.
 */
export function renderOrders(items: Order[]): string {
	if (!items.length) return "заказов нет"
	const urls = new Set(items.map(o => o.url).filter((v): v is string => !!v))
	const common = urls.size === 1 && items.every(o => o.url) ? [...urls][0] : undefined

	const out: string[] = []
	if (common) out.push(link(common))
	for (const o of items) {
		const own = common ? undefined : o.url
		out.push(`${bold(`№ ${o.id}`)}  ${dim(isoDate(o.date) || "—")}  ${green(o.status)}  ${bold(money(o.total))}${own ? `  ${link(own)}` : ""}`)
		if (o.items?.length) {
			out.push(table(o.items.map((it, i) => [
				`  ${i + 1}`, cyan(it.article), bold(it.brand), it.name.slice(0, 40),
				`${it.qty} шт`, money(it.price), money(it.sum ?? it.price * it.qty),
			])))
			out.push(urlList(o.items).replace(/^\n/, ""))
		}
	}
	return out.filter(Boolean).join("\n")
}

/**
 * Машина настолько, насколько её рисует таблица: `Car` из контракта и
 * `GarageCar` из локального гаража отличаются идентификаторами, а не тем,
 * что видит человек.
 */
export type CarLike = {
	brand: string
	model: string
	modification?: string
	year?: number
	engine?: string
	vin?: string
	odometer?: number
}

export function renderCars<T extends CarLike>(cars: T[], cols: Col<T>[] = []): string {
	if (!cars.length) return "гараж пуст"
	return table(cars.map(c => cells(cols, c, [
		bold([c.brand, c.model].filter(Boolean).join(" ")), c.modification ?? c.engine ?? dim("—"),
		c.year ? String(c.year) : dim("—"), c.vin ?? dim("—"),
		c.odometer ? `${c.odometer.toLocaleString("ru-RU")} км` : dim("—"),
	])), heads(cols, ["АВТОМОБИЛЬ", "МОДИФИКАЦИЯ", "ГОД", "VIN", "ПРОБЕГ"]))
}


export function renderDisplay(d: Display | null | undefined): string {
	if (!d) return dim("не авторизован")
	return fields([["имя", bold(d.name)], ["email", d.email ?? "—"], ["телефон", d.phone ?? "—"]])
}

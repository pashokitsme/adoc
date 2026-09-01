// render.ts — вывод в терминал. Цвета гаснут вне TTY и при NO_COLOR,
// чтобы `adoc ... | grep` не ловил escape-последовательности.

import type { Basket, BrandHit, Car, Display, Offer, Product, Reviews } from "./contract.ts"

const plain = !process.stdout.isTTY || !!process.env.NO_COLOR
const wrap = (code: string) => (s: string) => (plain ? s : `\x1b[${code}m${s}\x1b[0m`)

export const bold = wrap("1")
export const dim = wrap("2")
export const red = wrap("31")
export const green = wrap("32")
export const yellow = wrap("33")
export const blue = wrap("34")
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

/** Маскировка для вывода: показываем ровно столько, чтобы человек себя узнал. */
export function maskEmail(v: string | undefined): string {
	if (!v) return "—"
	const at = v.indexOf("@")
	if (at < 1) return v
	const name = v.slice(0, at)
	const head = name.slice(0, Math.min(2, name.length))
	return `${head}${"•".repeat(Math.max(1, name.length - head.length))}${v.slice(at)}`
}

export function maskPhone(v: string | undefined): string {
	if (!v) return "—"
	const digits = v.replace(/\D/g, "")
	if (digits.length < 4) return v
	return `${v.startsWith("+") ? "+" : ""}${digits[0] ?? ""}••••••${digits.slice(-4)}`
}

/** Пары «поле — значение» с выровненной колонкой. */
export function fields(rows: [string, string][], indent = "  "): string {
	if (!rows.length) return ""
	const w = Math.max(...rows.map(r => r[0].length))
	return rows.map(([k, v]) => `${indent}${dim(k.padEnd(w))}  ${v}`).join("\n")
}

export function rule(width = 44): string {
	return dim("─".repeat(width))
}

export const isoDate = (s: string | undefined): string | undefined => s?.slice(0, 10)

const ratingCell = (r: { average: number; count: number } | undefined) =>
	r && r.count ? `${r.average.toFixed(1)}★ (${r.count})` : dim("—")

const qtyCell = (q: number | undefined) => (q ? green(`${q} шт`) : dim("нет"))

export function renderProducts(items: Product[]): string {
	if (!items.length) return "ничего не найдено"
	return table(items.map(p => [
		cyan(p.article), bold(p.brand), p.name.slice(0, 50),
		money(p.price), qtyCell(p.quantity), ratingCell(p.rating),
	]), ["АРТИКУЛ", "БРЕНД", "НАЗВАНИЕ", "ОТ", "НАЛИЧИЕ", "РЕЙТИНГ"])
}

export function renderBrands(items: BrandHit[]): string {
	if (!items.length) return "не найдено"
	return table(items.map(b => [bold(b.brand), cyan(b.article), b.name ?? "", ratingCell(b.rating)]),
		["БРЕНД", "АРТИКУЛ", "НАЗВАНИЕ", "РЕЙТИНГ"])
}

export function renderOffers(items: Offer[]): string {
	if (!items.length) return "предложений нет"
	return table(items.map((o, i) => [
		String(i + 1), bold(o.brand), (o.name ?? "").slice(0, 40), money(o.price), qtyCell(o.quantity),
		o.deliveryDays != null ? days(o.deliveryDays) : (o.deliveryDate ?? dim("—")),
		o.seller ?? dim("—"), ratingCell(o.rating), o.analog ? yellow("аналог") : "",
	]), ["#", "БРЕНД", "НАЗВАНИЕ", "ЦЕНА", "НАЛИЧИЕ", "СРОК", "ПРОДАВЕЦ", "РЕЙТИНГ", ""])
}

export function renderReviews(r: Reviews): string {
	const out: string[] = [dim(`отзывов: ${r.total}`)]
	if (r.rating) out.push(`${stars(r.rating.average)}  ${bold(r.rating.average.toFixed(2))}  ${dim(`${r.rating.count} оценок`)}`)
	for (const l of bar(r.rating?.histogram)) out.push(l)
	if (r.summary && (r.summary.pros.length || r.summary.cons.length)) {
		out.push(heading("Выжимка"))
		for (const p of r.summary.pros) out.push(`  ${green("+")} ${p}`)
		for (const c of r.summary.cons) out.push(`  ${red("−")} ${c}`)
	}
	for (const it of r.items) {
		const who = [it.author, it.purchased ? "покупка подтверждена" : ""].filter(Boolean).join(" · ")
		out.push(heading(`${it.rating ? stars(it.rating) + "  " : ""}${who || "аноним"}`) + (it.date ? dim(`  ${it.date}`) : ""))
		if (it.pros) out.push(`  ${green("+")} ${it.pros}`)
		if (it.cons) out.push(`  ${red("−")} ${it.cons}`)
		if (it.text) out.push(fold(it.text))
	}
	return out.join("\n")
}

export function renderBasket(b: Basket): string {
	if (!b.items.length) return "корзина пуста"
	const rows = b.items.map((it, i) => [
		`${i + 1}`, dim(it.id), cyan(it.article), bold(it.brand), (it.name ?? "").slice(0, 36),
		money(it.price), `${it.quantity}`, money(it.sum ?? it.price * it.quantity),
		it.deliveryDays != null ? days(it.deliveryDays) : (it.deliveryDate ?? dim("—")),
	])
	const total = b.total ?? b.items.reduce((s, it) => s + (it.sum ?? it.price * it.quantity), 0)
	return table(rows, ["#", "ID", "АРТИКУЛ", "БРЕНД", "НАЗВАНИЕ", "ЦЕНА", "КОЛ", "СУММА", "СРОК"]) +
		`\n${dim("итого")}  ${bold(money(total))}`
}

export function renderCars(cars: Car[]): string {
	if (!cars.length) return "гараж пуст"
	return table(cars.map(c => [
		bold([c.brand, c.model].filter(Boolean).join(" ")), c.modification ?? c.engine ?? dim("—"),
		c.year ? String(c.year) : dim("—"), c.vin ?? dim("—"),
		c.odometer ? `${c.odometer.toLocaleString("ru-RU")} км` : dim("—"),
	]), ["АВТОМОБИЛЬ", "МОДИФИКАЦИЯ", "ГОД", "VIN", "ПРОБЕГ"])
}

export function renderDisplay(d: Display | null | undefined): string {
	if (!d) return dim("не авторизован")
	return fields([["имя", bold(d.name)], ["email", d.email ?? "—"], ["телефон", d.phone ?? "—"]])
}

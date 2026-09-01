// render.ts — вывод в терминал. Цвета гаснут вне TTY и при NO_COLOR,
// чтобы `adoc ... | grep` не ловил escape-последовательности.

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

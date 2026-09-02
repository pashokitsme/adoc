// batch.ts — «несколько артикулов за один запуск» для part и analogs.
//
// Список приходит либо запятыми в первом слове (`part A,B,C`), либо файлом
// (`--file list.txt`, строка = «артикул [бренд]», `#` — комментарий). Второе
// нужно тем, у кого список длиннее командной строки: дефектовка на десяток
// позиций — обычное дело.
//
// Артикулы идут по очереди, а сайты внутри артикула — параллельно. Наоборот
// нельзя: сайты ограничивают темп по аккаунту (armtek отвечает 429 с капчей),
// и десять артикулов веером положили бы выдачу целиком.

import { ProviderError, cyan, need } from "../sdk/index.ts"
import type { Ctx, Output } from "./ctx.ts"
import { Ambiguous } from "./errors.ts"
import type { Failure } from "./partial.ts"

/** Строка списка: артикул и, если назвали, его собственный бренд. */
export type BatchItem = { article: string; brand?: string }

/**
 * Раздел выдачи по одному артикулу. `rows` наружу не идёт — по нему драйвер
 * решает, о чём говорить в подсказке про корзину.
 */
export type Section = {
	article: string
	json: Record<string, unknown>
	code: 0 | 1 | 2
	render(): string
	rows: unknown[]
	errors: Failure[]
}

const stripComment = (line: string): string => {
	const i = line.indexOf("#")
	return (i >= 0 ? line.slice(0, i) : line).trim()
}

/** Файл списка: «артикул [бренд]» построчно, пустые строки и `#` пропускаются. */
async function fromFile(path: string): Promise<BatchItem[]> {
	let text: string
	try {
		text = await Bun.file(path).text()
	} catch {
		throw new ProviderError("bad_args", `не читается файл списка: ${path}`)
	}
	const items: BatchItem[] = []
	for (const raw of text.split("\n")) {
		const line = stripComment(raw)
		if (!line) continue
		const [article, brand] = line.split(/\s+/)
		if (article) items.push({ article, ...(brand ? { brand } : {}) })
	}
	if (!items.length) throw new ProviderError("bad_args", `в файле ${path} нет ни одного артикула`)
	return items
}

/**
 * Артикулы команды. Бренд, названный словом или флагом, относится ко всем: у
 * списка из одного производителя это обычная форма записи. Бренд из файла
 * сильнее — он написан рядом со своим артикулом.
 */
export async function articlesOf(ctx: Ctx, wanted: string | undefined): Promise<BatchItem[]> {
	const file = typeof ctx.flags.file === "string" ? ctx.flags.file : undefined
	if (file) {
		// Первое слово рядом с --file — это уже не артикул, а недоразумение:
		// молча предпочесть одно другому значит спросить не то, что просили.
		if (ctx.args[0]) throw new ProviderError("bad_args", `--file и артикул ${ctx.args[0]} вместе не работают`)
		return (await fromFile(file)).map(it => {
			const brand = it.brand ?? wanted
			return brand ? { article: it.article, brand } : { article: it.article }
		})
	}
	const list = need(ctx.args[0], "артикул").split(",").map(a => a.trim()).filter(Boolean)
	if (!list.length) throw new ProviderError("bad_args", "артикул")
	return list.map(article => ({ article, ...(wanted ? { brand: wanted } : {}) }))
}

/**
 * Код возврата всего запуска. «Уточнить бренд» — это 2, но только когда
 * уточнять надо везде: один неоднозначный артикул из пяти не отменяет
 * остальных четырёх, и скрипт, который смотрит на код, не должен считать
 * такую выдачу вопросом. Остальное как обычно: 1 — когда не вышло нигде.
 */
const totalCode = (codes: (0 | 1 | 2)[]): 0 | 1 | 2 => {
	if (!codes.length) return 0
	if (codes.every(c => c === 2)) return 2
	return codes.every(c => c !== 0) ? 1 : 0
}

/** Отказы без повторов: один и тот же сайт падает на каждом артикуле одинаково. */
function uniqueFailures(sections: Section[]): Failure[] {
	const seen = new Set<string>()
	const out: Failure[] = []
	for (const s of sections) {
		for (const f of s.errors) {
			const key = `${f.provider}|${f.code}|${f.message}`
			if (seen.has(key)) continue
			seen.add(key)
			out.push(f)
		}
	}
	return out
}

/**
 * Прогон списка. Один артикул — форма ответа та же, что была всегда: и `--json`,
 * и код возврата, и неоднозначный бренд, который по-прежнему летит наружу
 * исключением, чтобы app.ts нарисовал таблицу вариантов. Несколько — разделы
 * друг под другом, а неоднозначность становится частью раздела: остальные
 * артикулы спросили не зря.
 */
export async function runBatch(
	ctx: Ctx,
	items: BatchItem[],
	one: (it: BatchItem, batch: boolean) => Promise<Section>,
	tail?: (sections: Section[]) => string[],
): Promise<Output> {
	const batch = items.length > 1
	const sections: Section[] = []
	for (const it of items) {
		try {
			sections.push(await one(it, batch))
		} catch (e) {
			// Один артикул — вопрос про бренд остаётся вопросом всего запуска.
			if (!batch || !(e instanceof Ambiguous)) throw e
			sections.push(ambiguousSection(it.article, e))
		}
	}

	if (!batch) {
		const only = sections[0]!
		return { json: only.json, code: only.code, render: only.render }
	}
	return {
		json: { items: sections.map(s => s.json), errors: uniqueFailures(sections) },
		code: totalCode(sections.map(s => s.code)),
		render: () => [...sections.map(s => s.render()), ...(tail?.(sections) ?? [])].join("\n\n"),
	}
}

/**
 * Неоднозначный бренд внутри списка: раздел показывает тот же вопрос, что
 * человек увидел бы поодиночке, — таблицу вариантов рисует app.ts, а здесь
 * достаточно строки с ними: раздел не должен обрывать остальной список.
 */
function ambiguousSection(article: string, e: Ambiguous): Section {
	const brands = e.brands.map(b => b.brand)
	return {
		article,
		json: { article, brand: null, ambiguous: brands, offers: [], analogs: [], errors: e.failures },
		code: 2,
		rows: [],
		errors: e.failures,
		render: () => `${cyan(article)} · ${e.message}\n  ${brands.join(", ")}`,
	}
}

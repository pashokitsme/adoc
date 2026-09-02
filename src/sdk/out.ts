// out.ts — единственная точка выхода из процесса. process.exit рубит всё, что
// ещё не ушло в трубу: через пайп оболочки Bun 1.3 теряет хвост за первым
// буфером (64 КБ), и ответ крупнее буфера уезжал бы обрезанным с кодом 0 —
// успех на неразбираемом JSON. Поэтому сначала дожидаемся слива, потом выходим.

import { noWarn } from "./config.ts"

export type Sink = { write(text: string, cb: () => void): unknown }

/**
 * Воронка предупреждений: одна на запуск. Делает две вещи, которые иначе
 * пришлось бы повторять в каждом месте, где что-то предупреждают.
 *
 * `ADOC_NO_WARN` — тишина: жёлтые строки нужны человеку, а вызывающему из
 * скрипта они мусорят stderr, который он читает ради настоящих ошибок.
 *
 * Дважды одну и ту же строку не печатаем: `part` спрашивает сайт двумя
 * шагами (бренды, потом предложения), и заметка вроде «цены показаны как для
 * гостя» приходила от обоих — человеку она новость ровно один раз.
 */
export function warnSink(write: (line: string) => void): (line: string) => void {
	const seen = new Set<string>()
	return line => {
		if (noWarn() || seen.has(line)) return
		seen.add(line)
		write(line)
	}
}

/**
 * Дожидается, пока текст действительно уйдёт в поток. Нужен всем, кто пишет
 * перед выходом: stderr обрезается на пайпе ровно так же, как stdout.
 */
export async function drain(sink: Sink, text: string): Promise<void> {
	if (!text) return
	await new Promise<void>(resolve => sink.write(text, () => resolve()))
}

export async function emit(sink: Sink, text: string, code: number): Promise<never> {
	await drain(sink, text)
	process.exit(code)
}

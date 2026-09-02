// out.ts — единственная точка выхода из процесса. process.exit рубит всё, что
// ещё не ушло в трубу: через пайп оболочки Bun 1.3 теряет хвост за первым
// буфером (64 КБ), и ответ крупнее буфера уезжал бы обрезанным с кодом 0 —
// успех на неразбираемом JSON. Поэтому сначала дожидаемся слива, потом выходим.

export type Sink = { write(text: string, cb: () => void): unknown }

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

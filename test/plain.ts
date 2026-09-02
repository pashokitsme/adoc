// plain.ts — вывод без украшений на время теста. Выдача сверяется как текст, а
// под pty (`bun test` из терминала) рендер включает и цвет, и терминальные
// ссылки: escape внутри ячейки ломает toContain, а в режиме osc8 адрес и вовсе
// прячется в escape вместо списка под таблицей. NO_COLOR гасит цвет одинаково и
// в трубе, и в терминале, ADOC_LINKS=list возвращает адреса списком.
//
// Возвращает функцию, которая ставит окружение назад: переменные общие на весь
// процесс, и оставленное значение утекло бы в соседние файлы тестов.

const KEYS = ["NO_COLOR", "ADOC_LINKS"] as const

export function plainOutput(): () => void {
	const saved = KEYS.map(k => [k, process.env[k]] as const)
	process.env.NO_COLOR = "1"
	process.env.ADOC_LINKS = "list"
	return () => {
		for (const [k, v] of saved) {
			if (v === undefined) delete process.env[k]
			else process.env[k] = v
		}
	}
}

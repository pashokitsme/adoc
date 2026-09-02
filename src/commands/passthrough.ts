// passthrough.ts — `adoc <provider> <команда> …`. Обёртка не разбирает ни
// команду, ни флаги и не читает вывод: у каждого сайта свой полный CLI, и
// появление у него новой команды не должно требовать правок здесь. stdio
// наследуется целиком — это тот же самый разговор, только имя бинаря короче.

import { CONFIG_DIR_ENV, TOOL, configDir, yellow } from "../sdk/index.ts"
import { COMMAND_NAMES } from "../app.ts"
import { discover } from "../core/registry.ts"
import { ID_RE } from "../core/store.ts"

/** Имена, которые провайдеру не отдаются ни при каких обстоятельствах. */
const RESERVED = new Set([...COMMAND_NAMES, "help"])

/** Код возврата провайдера или null, если первым словом стоит не его id. */
export async function passthrough(argv: string[]): Promise<number | null> {
	const id = argv[0]
	// Флаг первым словом — вопрос к самой обёртке. Имя проверяется тем же
	// правилом, что и в реестре: «..» или имя с косой чертой провайдером не
	// бывает, а бинарь берётся только из реестра — не из того, что набрали.
	if (!id || id.startsWith("-") || !ID_RE.test(id)) return null

	// Только discover: describe здесь не нужен, а лишний запуск провайдера
	// стоил бы задержки на каждой проброшенной команде.
	const entry = (await discover()).find(p => p.id === id)
	if (!entry) return null

	// Своя команда всегда старше: провайдер с именем команды обёртки
	// (исполняемый adoc-part в PATH) не должен молча перехватывать `adoc part`.
	// Говорим об этом вслух — иначе непонятно, почему поставленный рядом бинарь
	// «не работает», — но только когда такой провайдер и правда нашёлся.
	if (RESERVED.has(id)) {
		process.stderr.write(`${yellow(`${TOOL}: провайдер «${id}» называется как команда обёртки — команда важнее; сам провайдер доступен как ${TOOL}-${id}`)}\n`)
		return null
	}

	// Голый `adoc beta` — просьба показать, что сайт умеет. Спрашиваем справку
	// явно: провайдер вправе считать пустой argv ошибкой.
	const rest = argv.length > 1 ? argv.slice(1) : ["--help"]
	// Ни таймаута, ни подмешанного --json: `login` ждёт человека, а длинная
	// выдача идёт минутами — обрывать их обёртке нечем и незачем.
	const proc = Bun.spawn([...entry.bin, ...rest], {
		env: { ...process.env, [CONFIG_DIR_ENV]: configDir() },
		stdin: "inherit", stdout: "inherit", stderr: "inherit",
	})
	// Смерть по сигналу Bun сам отдаёт как 128+n — тот же код, что вернула бы
	// оболочка, запусти она провайдера напрямую.
	return await proc.exited
}

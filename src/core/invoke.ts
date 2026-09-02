// invoke.ts — единственный способ поговорить с провайдером: запустить его
// процессом и прочитать один JSON-объект из stdout. Ни импортов провайдера,
// ни общей памяти: чужая реализация контракта может быть на любом языке.

import { CONFIG_DIR_ENV, TOOL, configDir, yellow } from "../sdk/index.ts"
import type { BrandHit, ErrorCode } from "../sdk/index.ts"

/** Столько ждём ответа. Дальше SIGTERM: висящий сайт не должен вешать выдачу. */
export const INVOKE_TIMEOUT_MS = 30_000

/** describe обязан отвечать без сети, поэтому ждём его куда меньше. */
export const DESCRIBE_TIMEOUT_MS = 10_000

/** А вот login — это диалог с человеком: пароль ищут в почте и в менеджере. */
export const LOGIN_TIMEOUT_MS = 300_000

/** Между SIGTERM и SIGKILL: столько даём на «положить трубку» по-хорошему. */
const KILL_GRACE_MS = 2_000

const JSON_FLAG = "--json"

const CODES = new Set<string>(["auth", "http", "notfound", "tty", "timeout", "bad_args", "internal", "ambiguous"])

export type InvokeError = { code: ErrorCode; message: string; items?: BrandHit[] }

export type InvokeResult =
	| { ok: true; json: unknown; stderr: string; warnings: string[] }
	| { ok: false; error: InvokeError; stderr: string; warnings: string[] }

export type InvokeOpts = {
	timeoutMs?: number
	/** login: stdin и подсказки идут прямо в терминал, stdout всё равно наш. */
	interactive?: boolean
	/** Дополнительные переменные окружения — нужны тестам и только им. */
	env?: Record<string, string>
	/** id провайдера: наши собственные ошибки обязаны называть виноватого. */
	id?: string
}

export async function invoke(bin: string[], args: string[], opts: InvokeOpts = {}): Promise<InvokeResult> {
	const timeoutMs = opts.timeoutMs ?? INVOKE_TIMEOUT_MS
	const warnings: string[] = []

	// Список аргументов, а не строка для оболочки: артикул с пробелом или
	// кавычкой — обычное дело, и склеивать его в команду нельзя.
	// --json свой у вызывающего уже мог быть: контракт обещает ровно один.
	const asked = args.some(a => a === JSON_FLAG || a.startsWith(`${JSON_FLAG}=`))
	const argv = [...bin, ...args, ...(asked ? [] : [JSON_FLAG])]
	// Провайдер, названный в наших сообщениях, а не в его собственных: id знает
	// только вызывающий, но без имени «вышел с кодом 1» бесполезно.
	const who = opts.id ?? bin[0] ?? "?"

	let proc: Bun.Subprocess<"ignore" | "inherit", "pipe", "pipe">
	try {
		proc = Bun.spawn(argv, {
			// Каталог конфига передаём явно: ребёнок обязан писать свой аккаунт
			// туда же, куда смотрит обёртка, даже если у него другое окружение.
			env: { ...process.env, [CONFIG_DIR_ENV]: configDir(), ...opts.env },
			stdin: opts.interactive ? "inherit" : "ignore",
			stdout: "pipe",
			stderr: "pipe",
		})
	} catch (e) {
		// Бинарь мог исчезнуть между обнаружением и запуском, оказаться без бита
		// x или с интерпретатором, которого нет. Это беда одного провайдера:
		// исключение отсюда унесло бы и всех соседей по Promise.all.
		const why = e instanceof Error ? e.message : String(e)
		return { ok: false, error: { code: "internal", message: `не удалось запустить ${bin.join(" ")}: ${why}` }, stderr: "", warnings }
	}

	let timedOut = false
	let hard: ReturnType<typeof setTimeout> | undefined
	const timer = setTimeout(() => {
		timedOut = true
		kill(proc, "SIGTERM")
		// Упрямый ребёнок SIGTERM может и не заметить: тогда добиваем.
		hard = setTimeout(() => kill(proc, "SIGKILL"), KILL_GRACE_MS)
	}, timeoutMs)

	let out = "", err = ""
	try {
		// Обе трубы читаются разом. По очереди нельзя: буфер трубы — 64 КБ, и
		// провайдер, у которого много stderr, встал бы на записи, не дойдя до
		// ответа, — а обёртка ждала бы его stdout. Оба ждут, никто не пишет.
		;[out, err] = await Promise.all([
			new Response(proc.stdout).text(),
			opts.interactive ? pump(proc.stderr) : new Response(proc.stderr).text(),
		])
		await proc.exited
	} finally {
		clearTimeout(timer)
		if (hard) clearTimeout(hard)
	}

	const fail = (code: ErrorCode, message: string): InvokeResult => ({ ok: false, error: { code, message }, stderr: err, warnings })
	if (timedOut) return fail("timeout", `провайдер ${who} не ответил за ${timeoutMs} мс`)

	const found = extractJson(out, warnings)
	const body = found && "value" in found ? found.value : undefined
	const failure = errorOf(body)
	// Тело важнее кода: провайдер объяснил, что случилось, своими словами.
	if (failure) return { ok: false, error: failure, stderr: err, warnings }

	// Тела нет — значит, всё, что мы знаем, это как он умер. Код 2 без тела не
	// делает ошибку неоднозначностью: items взять неоткуда, а пустой ambiguous
	// увёл бы человека уточнять бренд там, где провайдер просто упал.
	const tail = err.trim().split("\n").pop() ?? ""
	const why = tail ? `: ${tail}` : ""
	if (proc.signalCode) return fail("internal", `провайдер ${who} убит сигналом ${proc.signalCode}${why}`)
	const code = proc.exitCode ?? 1
	if (code !== 0) return fail("internal", `провайдер ${who} вышел с кодом ${code} без тела${why}`)
	// В stdout мог оказаться не один объект — гадать, который из них ответ,
	// хуже, чем сказать вслух: тихая догадка тут стоила бы чужой корзины.
	if (found && "problem" in found) return fail("internal", found.problem)
	if (body === undefined) return fail("internal", `провайдер ${who} не отдал JSON в stdout`)
	return { ok: true, json: body, stderr: err, warnings }
}

// Ребёнок мог уже выйти сам: убивать покойника незачем, а ошибку рантайма
// ловить и подавно.
function kill(proc: Bun.Subprocess, signal: "SIGTERM" | "SIGKILL"): void {
	if (proc.exitCode !== null || proc.signalCode !== null) return
	try { proc.kill(signal) } catch { /* уже умер между проверкой и выстрелом */ }
}

// В интерактивном режиме подсказки провайдера должны появляться сразу, а не
// после того, как пользователь вслепую введёт пароль.
async function pump(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader()
	for (;;) {
		const { done, value } = await reader.read()
		if (done) return ""
		process.stderr.write(value)
	}
}

/** Объект — и только объект: контракт другого верхнего уровня не знает. */
function parseObject(text: string): unknown {
	if (!text.startsWith("{") || !text.endsWith("}")) return undefined
	try {
		const v: unknown = JSON.parse(text)
		return v && typeof v === "object" && !Array.isArray(v) ? v : undefined
	} catch {
		return undefined
	}
}

type Extracted = { value: unknown } | { problem: string }

type Span = { value: unknown; start: number; end: number }

/**
 * Все верхнеуровневые объекты в тексте. Кавычки и экранирование считаются:
 * иначе `{"note":"}"}` разрубался бы пополам. Ищем именно объекты, а не «от
 * первой { до последней }»: два ответа подряд надо увидеть как два, в том
 * числе напечатанные в одну строку.
 */
function scanObjects(text: string): Span[] {
	const found: Span[] = []
	let depth = 0, start = -1, inStr = false, esc = false
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (inStr) {
			if (esc) esc = false
			else if (c === "\\") esc = true
			else if (c === '"') inStr = false
			continue
		}
		if (c === '"') { inStr = true; continue }
		if (c === "{") { if (depth === 0) start = i; depth++; continue }
		if (c === "}" && depth > 0 && --depth === 0 && start >= 0) {
			const value = parseObject(text.slice(start, i + 1))
			if (value !== undefined) found.push({ value, start, end: i + 1 })
			start = -1
		}
	}
	return found
}

/**
 * Контракт требует в stdout ровно один объект, но чужая реализация нет-нет да
 * и напечатает лишнее. Тогда берём единственный найденный объект и честно
 * говорим, что что-то отбросили: молчаливое исправление чужих багов кончается
 * тем, что их никто не чинит. Несколько объектов — уже не мусор, а вопрос
 * «который из них ответ»: на него отвечает провайдер, а не мы.
 */
function extractJson(out: string, warnings: string[]): Extracted | null {
	const text = out.trim()
	if (!text) return null
	const found = scanObjects(text)
	if (found.length > 1) return { problem: `провайдер напечатал в stdout несколько JSON-объектов (${found.length}), а контракт требует один` }
	const one = found[0]
	if (!one) return null
	if (one.start !== 0 || one.end !== text.length) warnings.push("провайдер печатал в stdout не только JSON — лишнее отброшено")
	return { value: one.value }
}

/**
 * Разговор провайдера с человеком: его stderr уходит наружу как есть — это
 * его собственные слова, — а наши замечания о его поведении идут подписанными.
 * Зовётся на каждый ответ, включая `describe`: спека требует предупреждать о
 * мусоре в stdout везде, а не только в командах выдачи.
 */
export function passNoise(id: string, r: InvokeResult, warn: (line: string) => void): void {
	if (r.stderr.trim()) warn(r.stderr.replace(/\n+$/, ""))
	for (const w of r.warnings) warn(yellow(`${TOOL}: ${id}: ${w}`))
}

function errorOf(body: unknown): InvokeError | null {
	if (!body || typeof body !== "object") return null
	const e = (body as { error?: unknown }).error
	if (!e || typeof e !== "object") return null
	const { code, message, items } = e as { code?: unknown; message?: unknown; items?: unknown }
	return {
		code: typeof code === "string" && CODES.has(code) ? code as ErrorCode : "internal",
		message: typeof message === "string" && message ? message : "провайдер не объяснил ошибку",
		...(Array.isArray(items) ? { items: items as BrandHit[] } : {}),
	}
}

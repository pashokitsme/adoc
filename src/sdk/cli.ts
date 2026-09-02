// cli.ts — argv и ввод с терминала. Подсказки идут в stderr: stdout при --json
// должен содержать ровно один JSON-объект.

import { ProviderError } from "./errors.ts"

export type Flags = Record<string, string | true>

/**
 * argv → позиционные аргументы и флаги.
 *
 * Флаг со значением (`valueFlags`) требует значения: `--page --json` раньше
 * съедал бы `--json` как значение страницы и молча терял бы формат вывода.
 * Остальные флаги булевы и принимают только `=true`/`=false`: `--json=1` —
 * это опечатка, а не «включено», и лучше сказать об этом сразу.
 */
export function parseArgv(argv: string[], valueFlags: string[]): { args: string[]; flags: Flags } {
	const flags: Flags = {}
	const args: string[] = []
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!
		if (a === "-h") { flags.help = true; continue }
		if (!a.startsWith("--")) { args.push(a); continue }

		const eq = a.indexOf("=")
		const k = eq >= 0 ? a.slice(2, eq) : a.slice(2)
		const wantsValue = valueFlags.includes(k)

		if (eq >= 0) {
			const v = a.slice(eq + 1)
			if (wantsValue) { flags[k] = v; continue }
			// «=false» — то же самое, что флаг не указан вовсе
			if (v === "false") delete flags[k]
			else if (v === "true") flags[k] = true
			else throw new ProviderError("bad_args", `--${k}: булев флаг, значение бывает только true или false, а не «${v}»`)
			continue
		}

		if (wantsValue) {
			const next = argv[i + 1]
			if (next === undefined || next.startsWith("--")) throw new ProviderError("bad_args", `--${k}: нужно значение`)
			flags[k] = next
			i++
			continue
		}
		flags[k] = true
	}
	return { args, flags }
}

/**
 * Целое ≥ 1: `--page`, `--limit`, `--sort` и числовые аргументы вроде
 * `garage main <carId>`. Ноль и дробное сайту бессмысленны и вернулись бы
 * пустой выдачей или невнятной ошибкой сервера вместо честного bad_args.
 */
export function positiveInt(what: string, v: string | true | undefined): number {
	if (v === undefined || v === true || v === "") throw new ProviderError("bad_args", `${what}: нужно значение`)
	const n = Number(v)
	if (!Number.isInteger(n) || n < 1) throw new ProviderError("bad_args", `${what}: нужно целое число не меньше 1, а не «${v}»`)
	return n
}

export const hasTTY = (): boolean => !!process.stdin.isTTY

// Построчное чтение stdin. Остаток буфера переживает вызов: пайп может
// прислать несколько строк одним куском, а закрытый поток не должен
// подвешивать процесс.
let leftover = ""
let stdinEnded = false

export function readLine(prompt: string): Promise<string> {
	process.stderr.write(prompt)
	const nl = leftover.indexOf("\n")
	if (nl >= 0) {
		const line = leftover.slice(0, nl)
		leftover = leftover.slice(nl + 1)
		return Promise.resolve(line)
	}
	if (stdinEnded) {
		const rest = leftover
		leftover = ""
		return Promise.resolve(rest)
	}
	return new Promise<string>(resolve => {
		process.stdin.setEncoding("utf8")
		const done = (v: string) => {
			process.stdin.off("data", onData)
			process.stdin.off("end", onEnd)
			process.stdin.pause()
			resolve(v)
		}
		const onData = (d: string) => {
			leftover += d
			const i = leftover.indexOf("\n")
			if (i < 0) return
			const line = leftover.slice(0, i)
			leftover = leftover.slice(i + 1)
			done(line)
		}
		const onEnd = () => {
			stdinEnded = true
			const rest = leftover
			leftover = ""
			done(rest)
		}
		process.stdin.on("data", onData)
		process.stdin.on("end", onEnd)
		process.stdin.resume()
	})
}

// Что бы ни случилось дальше, терминал не должен остаться без эха.
process.on("exit", () => {
	try { if (process.stdin.isTTY) process.stdin.setRawMode(false) } catch { /* уже закрыт */ }
})

/** Пароль с выключенным эхом. Никуда не сохраняется, только уходит в запрос. */
export async function readSecret(prompt: string): Promise<string> {
	if (!process.stdin.isTTY) return await readLine(prompt)
	process.stderr.write(prompt)
	process.stdin.setRawMode(true)
	process.stdin.resume()
	process.stdin.setEncoding("utf8")
	return new Promise<string>(resolve => {
		let buf = ""
		const finish = (v: string) => {
			process.stdin.off("data", onData)
			process.stdin.setRawMode(false)
			process.stdin.pause()
			process.stderr.write("\n")
			resolve(v)
		}
		const onData = (chunk: string) => {
			for (const c of chunk) {
				if (c === "\r" || c === "\n") return finish(buf)
				if (c === "\u0003") { process.stdin.setRawMode(false); process.stderr.write("\n"); process.exit(130) }
				if (c === "\u007f" || c === "\b") {
					if (buf) { buf = buf.slice(0, -1); process.stderr.write("\b \b") }
					continue
				}
				if (c < " ") continue // управляющие символы в пароль не пускаем
				buf += c
				process.stderr.write("•")
			}
		}
		process.stdin.on("data", onData)
	})
}

/** Обязательный позиционный аргумент. */
export function need(v: string | undefined, what: string): string {
	if (!v) throw new ProviderError("bad_args", `нужен ${what}`)
	return v
}

/**
 * `--ref <json>` — непрозрачный объект сайта: пришёл в `offers`, уходит обратно
 * в `basket add`. Ни SDK, ни обёртка внутрь не смотрят.
 */
export function parseRef(v: string | true | undefined): Record<string, unknown> {
	if (typeof v !== "string" || !v) throw new ProviderError("bad_args", "нужен --ref <json> из выдачи offers")
	try {
		const o = JSON.parse(v) as unknown
		if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error()
		return o as Record<string, unknown>
	} catch {
		throw new ProviderError("bad_args", "--ref должен быть JSON-объектом")
	}
}

/**
 * Целое ≥ 0: `--qty`, `--year`, `--odometer`. `undefined` — флага нет; ноль
 * законен (пробег), поэтому не `positiveInt`.
 */
export function intFlag(name: string, v: string | true | undefined): number | undefined {
	if (v === undefined) return undefined
	if (v === true || v === "") throw new ProviderError("bad_args", `--${name}: нужно значение`)
	const n = Number(v)
	if (!Number.isInteger(n) || n < 0) throw new ProviderError("bad_args", `--${name}: нужно целое число не меньше нуля, а не «${v}»`)
	return n
}

// cli.ts — argv и ввод с терминала. Подсказки идут в stderr: stdout при --json
// должен содержать ровно один JSON-объект.

export type Flags = Record<string, string | true>

export function parseArgv(argv: string[], valueFlags: string[]): { args: string[]; flags: Flags } {
	const flags: Flags = {}
	const args: string[] = []
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!
		if (a === "-h" || a === "--help") flags.help = true
		else if (a.startsWith("--")) {
			const eq = a.indexOf("=")
			const k = eq >= 0 ? a.slice(2, eq) : a.slice(2)
			if (eq >= 0) flags[k] = a.slice(eq + 1)
			else if (valueFlags.includes(k)) flags[k] = argv[++i] ?? ""
			else flags[k] = true
		} else args.push(a)
	}
	return { args, flags }
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

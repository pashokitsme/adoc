// registry.ts — какие провайдеры есть. Встроенные ищутся по пути относительно
// самого агрегатора, чтобы он работал и без глобальной установки; внешние —
// исполняемые adoc-* в PATH, на любом языке. ADOC_PROVIDERS_DIR подменяет
// весь набор целиком: так тесты гоняют фикстуры и никогда не трогают ни
// настоящих провайдеров, ни сеть.

import { access, readdir } from "node:fs/promises"
import { constants } from "node:fs"
import { delimiter, join } from "node:path"
import { ProviderError, TOOL } from "../sdk/index.ts"
import type { Describe, Flags } from "../sdk/index.ts"
import type { Cap } from "./delta.ts"
import { ID_RE } from "./store.ts"
import { DESCRIBE_TIMEOUT_MS, invoke, passNoise } from "./invoke.ts"
import { parseDescribe } from "./validate.ts"

export const PROVIDERS_DIR_ENV = `${TOOL.toUpperCase()}_PROVIDERS_DIR`

export type ProviderEntry = {
	id: string
	/** Команда запуска целиком: ["bun", "/путь/main.ts"] или ["/usr/bin/adoc-armtek"]. */
	bin: string[]
	source: "bundled" | "path" | "dir"
}

export type Provider = ProviderEntry & { describe: Describe }
export type BadProvider = ProviderEntry & { message: string }
export type Loaded = { ok: Provider[]; bad: BadProvider[] }

const readable = async (path: string): Promise<boolean> => {
	try { await access(path, constants.R_OK); return true } catch { return false }
}

const executable = async (path: string): Promise<boolean> => {
	try { await access(path, constants.X_OK); return true } catch { return false }
}

async function fromDir(dir: string, source: ProviderEntry["source"]): Promise<ProviderEntry[]> {
	let names: string[]
	try { names = await readdir(dir) } catch { return [] }
	const out: ProviderEntry[] = []
	for (const name of names.sort()) {
		// id — то же правило, что у файлов аккаунтов: из него потом собираются
		// пути и аргументы, а «..» или каталог с пробелом провайдером не бывает.
		if (!ID_RE.test(name)) continue
		const main = join(dir, name, "main.ts")
		if (await readable(main)) out.push({ id: name, bin: ["bun", main], source })
	}
	return out
}

async function fromPath(): Promise<ProviderEntry[]> {
	const prefix = `${TOOL}-`
	const out: ProviderEntry[] = []
	const seen = new Set<string>()
	for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
		let names: string[]
		try { names = await readdir(dir) } catch { continue }
		for (const name of names.sort()) {
			if (!name.startsWith(prefix) || name.length === prefix.length) continue
			const id = name.slice(prefix.length)
			if (!ID_RE.test(id)) continue
			if (seen.has(id)) continue // первый в PATH побеждает, как у самой оболочки
			const file = join(dir, name)
			if (!(await executable(file))) continue
			seen.add(id)
			out.push({ id, bin: [file], source: "path" })
		}
	}
	return out
}

export async function discover(): Promise<ProviderEntry[]> {
	const forced = process.env[PROVIDERS_DIR_ENV]
	if (forced) return await fromDir(forced, "dir")

	// import.meta.dir — src/core, значит соседний src/providers. Путь считается
	// от файла, а не от cwd: агрегатор запускают откуда угодно.
	const bundled = await fromDir(join(import.meta.dir, "..", "providers"), "bundled")
	const ids = new Set(bundled.map(p => p.id))
	const external = (await fromPath()).filter(p => !ids.has(p.id))
	return [...bundled, ...external].sort((a, b) => a.id.localeCompare(b.id))
}

const list = (v: string | true | undefined): string[] =>
	typeof v === "string" ? v.split(",").map(s => s.trim()).filter(Boolean) : []

export type SelectOpts = {
	/**
	 * Пустой выбор — не ошибка. Нужно `accounts`: провайдеров может не быть
	 * вовсе, а файлы аккаунтов от них остаться, и показать их важнее, чем
	 * ругаться на пустой список.
	 */
	allowEmpty?: boolean
}

/** `--only`/`--providers`, `--skip` и фильтр по capability. */
export function select(ok: Provider[], flags: Flags, cap?: Cap, opts: SelectOpts = {}): Provider[] {
	const known = new Set(ok.map(p => p.id))
	const check = (ids: string[], flag: string): string[] => {
		for (const id of ids) if (!known.has(id)) throw new ProviderError("bad_args", `--${flag}: нет провайдера «${id}» — есть ${[...known].join(", ") || "ни одного"}`)
		return ids
	}
	// --providers — синоним --only: так эту мысль чаще всего и записывают.
	const only = check([...list(flags.only), ...list(flags.providers)], flags.only !== undefined ? "only" : "providers")
	const skip = new Set(check(list(flags.skip), "skip"))

	let out = ok.filter(p => (only.length ? only.includes(p.id) : true) && !skip.has(p.id))
	if (cap) out = out.filter(p => (p.describe.capabilities as Cap[]).includes(cap))
	if (!out.length && !opts.allowEmpty) {
		throw new ProviderError("bad_args", cap
			? `ни один выбранный провайдер не умеет ${cap} — смотри ${TOOL} providers`
			: `не осталось ни одного провайдера — смотри ${TOOL} providers`)
	}
	return out
}

/**
 * describe у всех найденных провайдеров параллельно. Ответ кэшируется на
 * запуск (кэшем владеет app.ts), но не на диск: список команд провайдера
 * меняется вместе с его версией, а протухший кэш врал бы в справке.
 * Таймаут короче общего: describe обязан работать без сети.
 * `warn` необязателен только для тестов реестра; команды передают свой.
 */
export async function load(warn: (line: string) => void = () => {}): Promise<Loaded> {
	const entries = await discover()
	const settled = await Promise.all(entries.map(async (e): Promise<Provider | BadProvider> => {
		// id уезжает в invoke: наши собственные ошибки — «не запустился»,
		// «вышел с кодом», «не ответил» — обязаны называть, кто именно.
		const r = await invoke(e.bin, ["describe"], { timeoutMs: DESCRIBE_TIMEOUT_MS, id: e.id })
		passNoise(e.id, r, warn)
		if (!r.ok) return { ...e, message: r.error.message }
		try {
			return { ...e, describe: parseDescribe(r.json, e.id) }
		} catch (err) {
			return { ...e, message: err instanceof Error ? err.message : String(err) }
		}
	}))
	return {
		ok: settled.filter((p): p is Provider => "describe" in p),
		bad: settled.filter((p): p is BadProvider => "message" in p),
	}
}

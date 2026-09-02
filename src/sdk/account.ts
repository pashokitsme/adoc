// account.ts — файл аккаунта провайдера: accounts/<id>.json с правами 600.
// Содержимое — дело провайдера; SDK гарантирует только путь и права.

import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { configDir } from "./config.ts"

export type AccountStore<A> = {
	readonly path: string
	load(): Promise<A | null>
	save(a: A): Promise<void>
	clear(): Promise<void>
}

export function accountStore<A = unknown>(id: string): AccountStore<A> {
	const path = join(configDir(), "accounts", `${id}.json`)
	return {
		path,
		async load() {
			try {
				return JSON.parse(await readFile(path, "utf8")) as A
			} catch {
				return null
			}
		},
		async save(a) {
			await mkdir(dirname(path), { recursive: true })
			// mode в writeFile действует только при создании, поэтому chmod следом
			await writeFile(path, JSON.stringify(a, null, 2), { mode: 0o600 })
			await chmod(path, 0o600)
		},
		async clear() {
			try { await unlink(path) } catch { /* уже нет */ }
		},
	}
}

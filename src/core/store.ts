// store.ts — файлы, которыми владеет сама обёртка: garage.json и
// last-part.json. Запись атомарная (tmp + rename): прерванный на середине
// процесс иначе оставил бы обрезанный гараж, а он единственный экземпляр.
// Файлы аккаунтов пишет провайдер — обёртке позволено только перечислить и
// удалить, поэтому здесь нет ни одной записи в accounts/.

import { chmod, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { ProviderError, configDir } from "../sdk/index.ts"

/** Нет файла — это состояние, а не сбой. Всё остальное — сбой. */
const missing = (e: unknown): boolean => (e as NodeJS.ErrnoException).code === "ENOENT"

export const filePath = (name: string): string => join(configDir(), name)

export async function readJson<T>(name: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(filePath(name), "utf8")) as T
	} catch {
		// Нет файла и битый файл — одно и то же: состояния нет. Падать на
		// испорченном кэше выдачи незачем, он перезапишется следующей командой.
		return null
	}
}

/**
 * `mode` задаётся там, где в файле лежат личные данные (гараж хранит VIN):
 * права ставятся до rename, чтобы файл ни мгновения не полежал читаемым для
 * всех. chmod отдельной строкой, потому что режим у writeFile режется umask.
 */
export async function writeJson(name: string, data: unknown, mode?: number): Promise<void> {
	const path = filePath(name)
	await mkdir(dirname(path), { recursive: true })
	const tmp = `${path}.${process.pid}.tmp`
	try {
		await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, mode === undefined ? undefined : { mode })
		if (mode !== undefined) await chmod(tmp, mode)
		await rename(tmp, path)
	} catch (e) {
		await unlink(tmp).catch(() => {})
		throw e
	}
}

const accountsDir = (): string => join(configDir(), "accounts")

/** Допустимый id провайдера: из него складываются пути, поэтому правило одно на всю обёртку. */
export const ID_RE = /^[a-z0-9][a-z0-9_-]*$/

/**
 * id провайдера приходит из аргументов пользователя (`adoc logout <id>`), а
 * ниже из него собирается путь. Без проверки `logout ../garage` удалил бы
 * garage.json самой обёртки, поэтому всё, что не совпало с ID_RE, — bad_args.
 */
function checkId(id: string): string {
	if (!ID_RE.test(id)) throw new ProviderError("bad_args", `недопустимый id провайдера: ${JSON.stringify(id)}`)
	return id
}

/**
 * Кто вошёл хоть раз: имена файлов accounts/<id>.json. Содержимое не читается.
 * Имя, не подходящее под ID_RE, провайдером быть не может (реестр отбирает по
 * тому же правилу), а removeAccount на нём падает bad_args: показывать такой
 * файл значило бы советовать `logout`, который заведомо не сработает.
 */
export async function listAccountIds(): Promise<string[]> {
	try {
		const names = await readdir(accountsDir())
		return names.filter(n => n.endsWith(".json")).map(n => n.slice(0, -".json".length)).filter(id => ID_RE.test(id)).sort()
	} catch (e) {
		if (missing(e)) return []
		throw e
	}
}

/**
 * true — файл был и удалён, false — его и не было. Права, занятый файл и
 * каталог вместо файла — это ошибка: `logout`, отрапортовавший успех на
 * неудалённых токенах, хуже, чем `logout`, честно упавший.
 */
export async function removeAccount(id: string): Promise<boolean> {
	// Проверка вне try: bad_args не должен даже проходить мимо ветки ENOENT.
	const path = join(accountsDir(), `${checkId(id)}.json`)
	try {
		await unlink(path)
		return true
	} catch (e) {
		if (missing(e)) return false
		throw e
	}
}

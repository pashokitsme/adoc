// config.ts — имя тулзы и каталог конфига. Имя меняется здесь и в package.json.

import { homedir } from "node:os"
import { join } from "node:path"

export const TOOL = "adoc"
export const CONFIG_DIR_ENV = `${TOOL.toUpperCase()}_CONFIG_DIR`

/**
 * Глушилка предупреждений: жёлтые строки отказов, заметки провайдеров и
 * подсказка про клик. Ошибок и тела ответа она не касается — молчать о том,
 * почему команда не сработала, нельзя, — и код возврата от неё не меняется.
 */
export const NO_WARN_ENV = `${TOOL.toUpperCase()}_NO_WARN`

/** Решается на каждый вызов, как цвет и ссылки: окружение читают поздно. */
export const noWarn = (): boolean => !!process.env[NO_WARN_ENV]

/** $ADOC_CONFIG_DIR → $XDG_CONFIG_HOME/adoc → ~/.config/adoc */
export function configDir(): string {
	const env = process.env[CONFIG_DIR_ENV]
	if (env) return env
	return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), TOOL)
}

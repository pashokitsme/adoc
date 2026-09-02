// config.ts — имя тулзы и каталог конфига. Имя меняется здесь и в package.json.

import { homedir } from "node:os"
import { join } from "node:path"

export const TOOL = "adoc"
export const CONFIG_DIR_ENV = `${TOOL.toUpperCase()}_CONFIG_DIR`

/** $ADOC_CONFIG_DIR → $XDG_CONFIG_HOME/adoc → ~/.config/adoc */
export function configDir(): string {
	const env = process.env[CONFIG_DIR_ENV]
	if (env) return env
	return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), TOOL)
}

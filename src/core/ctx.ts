// ctx.ts — общий язык команд агрегатора. Команда получает разобранный argv и
// ленивый доступ к провайдерам, а возвращает две формы одного ответа: JSON для
// машины и текст для человека. Печатает их не команда, а app.ts.

import type { Flags } from "../sdk/index.ts"
import type { Cap } from "./delta.ts"
import type { Loaded, Provider, SelectOpts } from "./registry.ts"

export type Ctx = {
	/** Позиционные аргументы после имени команды. */
	args: string[]
	flags: Flags
	json: boolean
	/** Строка в stderr: предупреждения провайдеров и жёлтые строки отказов. */
	warn(line: string): void
	/** Все найденные провайдеры с их describe. Считается один раз на запуск. */
	load(): Promise<Loaded>
	/**
	 * Провайдеры после --only/--skip и, если задана, фильтра по capability.
	 * Пустой выбор — ошибка: команде выдачи спрашивать некого. Исключение
	 * просит явно тот, кому есть что сказать и без сайтов (`accounts`).
	 */
	pick(cap?: Cap, opts?: SelectOpts): Promise<Provider[]>
}

export type Output = { json: unknown; render(): string; code?: 0 | 1 | 2 }

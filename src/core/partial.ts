// partial.ts — модель частичного отказа. Один сайт лежит, второй отвечает:
// показать второй и честно сказать про первый лучше, чем не показать ничего.
// Отказ не прячется — жёлтая строка в stderr и поле errors в --json.

import { TOOL, yellow } from "../sdk/index.ts"
import type { ErrorCode } from "../sdk/index.ts"
import { passNoise, type InvokeResult } from "./invoke.ts"
import type { Provider } from "./registry.ts"

export type Failure = { provider: string; code: ErrorCode; message: string }
export type Got<T> = { provider: string; value: T }
export type Fanout<T> = { got: Got<T>[]; failures: Failure[]; asked: number }

const asFailure = (provider: string, e: unknown): Failure =>
	({ provider, code: "internal", message: e instanceof Error ? e.message : String(e) })

/**
 * Один и тот же вопрос всем провайдерам сразу. Ошибка любого рода — отказ
 * этого провайдера: try/catch внутри задачи делает то же, что Promise.allSettled,
 * но сразу в нужной форме.
 */
export async function fanout<T>(
	providers: Provider[],
	call: (p: Provider) => Promise<InvokeResult>,
	parse: (json: unknown, provider: string) => T,
	warn: (line: string) => void,
): Promise<Fanout<T>> {
	const settled = await Promise.all(providers.map(async (p): Promise<Got<T> | Failure> => {
		let r: InvokeResult
		try {
			r = await call(p)
		} catch (e) {
			return asFailure(p.id, e)
		}
		passNoise(p.id, r, warn)
		if (!r.ok) return { provider: p.id, code: r.error.code, message: r.error.message }
		try {
			return { provider: p.id, value: parse(r.json, p.id) }
		} catch (e) {
			return asFailure(p.id, e)
		}
	}))
	return {
		got: settled.filter((x): x is Got<T> => "value" in x),
		failures: settled.filter((x): x is Failure => "code" in x),
		asked: providers.length,
	}
}

/**
 * Виноватого надо назвать: сообщение приходит и от провайдера («HTTP 500»), и
 * от нас («провайдер armtek вышел с кодом 1»), и в общем списке отказов первое
 * без имени бесполезно. Но и дважды имя не пишем — строка «armtek: провайдер
 * armtek …» читается как заикание. Имя ищется целым словом: «autodoc.ru» в
 * чужом сообщении — это домен, а не провайдер «auto», и такую строку подписать
 * всё-таки надо. Единственное место, где это решается: и failureLine, и разбор
 * BadProvider зовут отсюда.
 */
export function blame(provider: string, message: string): string {
	const named = new RegExp(`(?<![\\p{L}\\p{N}_])${provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`, "u")
	return named.test(message) ? message : `${provider}: ${message}`
}

/**
 * Строка отказа всегда начинается с имени провайдера. Подсказка про login
 * собирается уже после имени: «adoc login armtek» здесь — команда, которую
 * набирают руками, а не упоминание виноватого, и на дубль имени не тянет.
 * Текст отделён от цвета: адресные команды (`basket add alpha …`) падают
 * ошибкой, а не жёлтой строкой, но подписывать виноватого обязаны так же —
 * правило подписи в обёртке одно, и escape-последовательности в теле --json
 * ему не нужны.
 */
export const failureText = (f: Failure): string =>
	f.code === "auth" ? `${f.provider}: нужен вход — ${TOOL} login ${f.provider}` : blame(f.provider, f.message)

export const failureLine = (f: Failure): string => yellow(failureText(f))

/** Не ответил никто из тех, кого спрашивали. Спрашивать было некого — не отказ. */
export const allFailed = (f: Fanout<unknown>): boolean => f.asked > 0 && f.got.length === 0

/**
 * Жёлтые строки в stderr и код возврата. `extra` — отказы предыдущего шага
 * (например, шага брендов у `part`): их тоже показываем, но на код возврата
 * влияет только последний вопрос — если на него ответил хоть кто-то, выдача есть.
 */
export function report(f: Fanout<unknown>, extra: Failure[], warn: (line: string) => void): 0 | 1 {
	for (const x of [...extra, ...f.failures]) warn(failureLine(x))
	return allFailed(f) ? 1 : 0
}

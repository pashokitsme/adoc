// api.ts — HTTP-слой armtek.ru: конверт ответа, ошибки, гостевой токен.
//
// Свой REST лежит на https://armtek.ru/rest/ru/ и документации не имеет;
// карта и проверенные вызовы — docs/armtek-api.md. Любой ответ приходит
// конвертом {data, arr_messages, execution_time}: текст ошибки для человека
// лежит в arr_messages[] с type === "E", а код — в HTTP-статусе.

import { HttpError, ProviderError, fetchJson } from "../../sdk/index.ts"

export const BASE = "https://armtek.ru/rest/ru/"

/**
 * Константы фронта из бандла. Без этой пары auth-microservice отвечает 401
 * даже на выдачу гостевого токена, поэтому они идут в каждый запрос.
 */
export const FRONT_HEADERS: Readonly<Record<string, string>> = {
	"X-AUTH-SYSTEM": "AUTH_MICROSERVICE_V1_ARMTEK_RU",
	"X-AUTH-TOKEN": "nJhNK87gJOOU6dfr",
}

export type ArmMessage = { type: string; text: string }
export type Envelope<T> = { data: T; arr_messages?: ArmMessage[] }

export type CallOpts = {
	method?: string
	body?: unknown
	token?: string
	timeoutMs?: number
}

/** Тексты ошибок из конверта; всё остальное (I, S, W) — не ошибки. */
export function errorTexts(env: unknown): string[] {
	const msgs = (env as Envelope<unknown> | null)?.arr_messages
	if (!Array.isArray(msgs)) return []
	return msgs.filter(m => m?.type === "E" && typeof m.text === "string").map(m => m.text)
}

/**
 * HttpError → ошибка контракта. 401 отдельно: агрегатору нужен код `auth`,
 * чтобы сказать «нужен вход», а не «сайт ответил 401».
 */
export function mapHttpError(e: unknown): ProviderError | null {
	if (!(e instanceof HttpError)) return null
	let text = ""
	try { text = errorTexts(JSON.parse(e.body)).join("; ") } catch { /* тело не конверт */ }
	if (e.status === 401) return new ProviderError("auth", text || "armtek: нужен вход")
	return new ProviderError("http", text ? `armtek: ${text}` : e.message)
}

/** Вызов REST: возвращает `data` из конверта или бросает ProviderError. */
export async function call<T>(path: string, opts: CallOpts = {}): Promise<T> {
	const headers: Record<string, string> = { ...FRONT_HEADERS, Accept: "application/json" }
	if (opts.token) headers.Authorization = `Bearer ${opts.token}`
	if (opts.body !== undefined) headers["Content-Type"] = "application/json"
	const init: RequestInit = {
		method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
		headers,
		...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
	}

	let env: Envelope<T> | null
	try {
		env = await fetchJson<Envelope<T> | null>(BASE + path, init, { timeoutMs: opts.timeoutMs })
	} catch (e) {
		throw mapHttpError(e) ?? e
	}

	// Валидация полей приходит статусом 200 с пустой data — без этой проверки
	// вызывающий получил бы null и молчаливо посчитал бы это пустой выдачей.
	const bad = errorTexts(env)
	if (bad.length && (env == null || env.data == null)) throw new ProviderError("http", `armtek: ${bad.join("; ")}`)
	if (env == null) throw new ProviderError("http", `armtek: пустой ответ на ${path}`)
	return env.data
}

export type Tokens = { accessToken: string; refreshToken?: string }

/** Гостевой токен: с ним работают поиск, отзывы и список точек выдачи. */
export const fetchGuestToken = (): Promise<Tokens> =>
	call<Tokens>("auth-microservice/v1/guest", { body: {} })

// http.ts — fetch с таймаутом и разбором JSON. Провайдер может им не
// пользоваться; autodoc держит свой call() и только мапит ошибки.

import { ProviderError } from "./errors.ts"

export class HttpError extends Error {
	constructor(readonly status: number, readonly url: string, readonly body: string) {
		super(`${url}: HTTP ${status}${body ? ` — ${body.slice(0, 200)}` : ""}`)
	}
}

export async function fetchJson<T = unknown>(
	url: string, init?: RequestInit, opts: { timeoutMs?: number } = {},
): Promise<T> {
	const timeoutMs = opts.timeoutMs ?? 20_000
	const ctl = new AbortController()
	const timer = setTimeout(() => ctl.abort(), timeoutMs)
	// Таймер снимается только после чтения тела: сервер, отдавший заголовки и
	// заглохший на теле, иначе висел бы вечно.
	try {
		const signal = init?.signal ? AbortSignal.any([init.signal, ctl.signal]) : ctl.signal
		const res = await fetch(url, { ...init, signal })
		const text = await res.text()
		if (!res.ok) throw new HttpError(res.status, url, text)
		if (!text) return null as T
		try {
			return JSON.parse(text) as T
		} catch {
			throw new HttpError(res.status, url, `сервер вернул не JSON: ${text.slice(0, 120)}`)
		}
	} catch (e) {
		// HttpError строится только по полученному ответу, значит запрос дошёл:
		// иначе 401 на грани таймера превратился бы в timeout, а это
		// противоположный совет пользователю — «залогинься» против «повтори».
		if (e instanceof HttpError) throw e
		// Только наш таймер — отмена сигналом вызывающего наружу идёт как есть.
		if (ctl.signal.aborted) throw new ProviderError("timeout", `${url}: нет ответа за ${timeoutMs} мс`)
		throw e
	} finally {
		clearTimeout(timer)
	}
}

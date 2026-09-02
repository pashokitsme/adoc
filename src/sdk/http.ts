// http.ts — fetch с таймаутом и разбором JSON. Провайдер может им не
// пользоваться; autodoc держит свой call() и только мапит ошибки.

import { ProviderError } from "./errors.ts"

/**
 * Заголовки «как из вкладки браузера». Оба сайта стоят за защитой, которая
 * смотрит не только на темп: голый запрос без `User-Agent`, `Origin` и
 * `Sec-Fetch-*` armtek отдаёт 429 с капчей уже на втором-третьем вызове, хотя
 * тот же запрос из вкладки проходит. Значения статические и никого не
 * опознают: это обычный десктопный Chrome, а не отпечаток человека.
 *
 * `origin` — страница, с которой запрос как бы уходит; `fetchSite` — `same-site`,
 * когда API живёт на соседнем поддомене (`web.autodoc.ru` против `www`).
 */
export const browserHeaders = (
	origin: string, fetchSite: "same-origin" | "same-site" | "cross-site" = "same-origin",
): Record<string, string> => ({
	"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
	"Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
	Origin: origin,
	Referer: `${origin}/`,
	"sec-ch-ua": '"Chromium";v="137", "Google Chrome";v="137", "Not/A)Brand";v="24"',
	"sec-ch-ua-mobile": "?0",
	"sec-ch-ua-platform": '"macOS"',
	"Sec-Fetch-Site": fetchSite,
	"Sec-Fetch-Mode": "cors",
	"Sec-Fetch-Dest": "empty",
})

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

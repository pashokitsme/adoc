// auth.ts — OIDC против login.autodoc.ru и хранение токена.
//
// OpenIddict, публичный клиент `Angular` без секрета.
//
// Вход идёт по grant_type=password: PKCE стороннему клиенту недоступен —
// единственный зарегистрированный redirect_uri ведёт в SPA, а она отвергает
// чужой колбэк с `could not find matching config for state` и код наружу не
// отдаёт. Подробности и проверка — в autodoc-api.md.

import { readFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import { accountStore, configDir, decodeClaims as jwtClaims } from "../../sdk/index.ts"
import { TIMEOUT_MS } from "./api.ts"

export const AUTH = "https://login.autodoc.ru"
export const CLIENT_ID = "Angular"
export const SCOPE = [
	"openid", "profile", "email", "offline_access",
	"ProductService", "BasketService", "ClientService", "OrderService",
	"FavoriteService", "GarageService", "DeliveryService", "CatalogUniversalService",
	"CatalogOriginalService", "PromoService", "CompanyService",
].join(" ")

export type Tokens = {
	access_token: string
	refresh_token?: string
	expires_at: number // unix seconds
}

export const ACCOUNT_ID = "autodoc"
const store = () => accountStore<Tokens>(ACCOUNT_ID)

export const loadTokens = (): Promise<Tokens | null> => store().load()
export const saveTokens = (t: Tokens): Promise<void> => store().save(t)
export const clearTokens = (): Promise<void> => store().clear()

/**
 * До версии 2 токен лежал в <config>/token.json. Переносим в accounts/autodoc.json,
 * только если нового файла ещё нет; тогда старый удаляем, чтобы refresh-токен не
 * жил в двух местах. Когда новый файл уже есть, старый не трогаем: его содержимое
 * могло бы затереть свежий вход.
 */
export async function migrateLegacyToken(): Promise<boolean> {
	const legacy = join(configDir(), "token.json")
	if (await store().load()) return false
	let t: Tokens
	try {
		t = JSON.parse(await readFile(legacy, "utf8")) as Tokens
	} catch {
		return false
	}
	await saveTokens(t)
	try { await unlink(legacy) } catch { /* уже нет */ }
	return true
}

// --- разбор токена --------------------------------------------------------

/**
 * Клеймы из access-токена. Подпись не проверяется — токен пришёл от сервера по
 * TLS и лежит в файле с правами 600; читаем его только чтобы показать человеку,
 * под кем он вошёл, а не чтобы принимать решения о доступе.
 */
export type Claims = {
	login?: string
	email?: string
	displayEmail?: string
	phone_number?: string
	unique_name?: string
	preferred_username?: string
	id?: string
	cityId?: string | number
	shopId?: string | number
	isOrganization?: string | boolean
	scope?: string | string[]
	exp?: number
	iat?: number
}

export const decodeClaims = (accessToken: string): Claims | null => jwtClaims<Claims>(accessToken)

// --- обмен и обновление ---------------------------------------------------

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
	const res = await fetch(`${AUTH}/connect/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(body).toString(),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	})
	const text = await res.text()
	if (!res.ok) throw new Error(`token endpoint вернул ${res.status}: ${text.slice(0, 300)}`)
	const j = JSON.parse(text) as { access_token: string; refresh_token?: string; expires_in?: number }
	return {
		access_token: j.access_token,
		refresh_token: j.refresh_token,
		expires_at: Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600),
	}
}

/**
 * Resource Owner Password Credentials. Сервер объявляет `password` в
 * grant_types_supported, а PKCE-поток бесполезен: SPA отвергает чужой колбэк
 * и код до пользователя не доезжает.
 *
 * Пароль живёт только в аргументе этого вызова — он не пишется на диск, не
 * попадает в лог и не может прийти из argv, чтобы не осесть в истории шелла.
 */
export const passwordGrant = (username: string, password: string) =>
	tokenRequest({ grant_type: "password", client_id: CLIENT_ID, scope: SCOPE, username, password })

export const refresh = (refresh_token: string) =>
	tokenRequest({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token })

/** Живой access-токен или null, если входа не было. Обновляет молча. */
export async function currentToken(): Promise<string | null> {
	const t = await loadTokens()
	if (!t) return null
	if (t.expires_at - 60 > Math.floor(Date.now() / 1000)) return t.access_token
	// в фикстурном режиме сети нет: протухший токен считаем отсутствующим
	if (process.env.ADOC_FIXTURES) return null
	if (!t.refresh_token) return null
	let fresh: Tokens
	try {
		fresh = await refresh(t.refresh_token)
	} catch {
		// refresh отозван или протух: держать негодный файл нельзя, иначе каждая
		// команда будет вечно повторять ошибку сервера вместо «нужен вход»
		await clearTokens()
		return null
	}
	// сервер может не вернуть новый refresh — тогда держимся за старый
	if (!fresh.refresh_token) fresh.refresh_token = t.refresh_token
	await saveTokens(fresh)
	return fresh.access_token
}

/** Достаёт токены из дампа sessionStorage залогиненного браузера. */
export type Pasted =
	| { tokens: Tokens }
	| { diag: string } // дамп ошибки SPA вместо самих токенов

export function parsePasted(input: string): Pasted | null {
	const s = input.trim()
	if (!s) return null

	// Токены ищем ПЕРВЫМИ: ключ authDiagSnapshot SPA пишет в тот же
	// sessionStorage, и проверка на него раньше разбора прятала бы валидный дамп.
	if (s.startsWith("{") || s.startsWith("[")) {
		let found: { access_token?: string; refresh_token?: string; expires_in?: number } = {}
		const walk = (v: unknown) => {
			if (!v || typeof v !== "object") return
			const o = v as Record<string, unknown>
			if (typeof o.access_token === "string" && !found.access_token) {
				found = {
					access_token: o.access_token,
					refresh_token: typeof o.refresh_token === "string" ? o.refresh_token : undefined,
					expires_in: typeof o.expires_in === "number" ? o.expires_in : undefined,
				}
			}
			for (const x of Object.values(o)) {
				if (typeof x === "string" && (x.startsWith("{") || x.startsWith("["))) {
					try { walk(JSON.parse(x)) } catch { /* не json — пропускаем */ }
				} else walk(x)
			}
		}
		try { walk(JSON.parse(s)) } catch { /* разберём как диагностику ниже */ }
		if (found.access_token) {
			return {
				tokens: {
					access_token: found.access_token,
					refresh_token: found.refresh_token,
					expires_at: Math.floor(Date.now() / 1000) + (found.expires_in ?? 3600),
				},
			}
		}
	}

	if (s.includes("authDiagSnapshot") || s.includes("could not find matching config")) {
		const m = s.match(/could not find matching config for state ([A-Za-z0-9._~-]+)/)
		return { diag: m?.[1] ?? "" }
	}

	return null
}

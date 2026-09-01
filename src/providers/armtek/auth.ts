// auth.ts — вход в armtek.ru, обновление токенов и содержимое accounts/armtek.json.
//
// Вход — POST auth-microservice/v1/auth/login с {login, password}: логином
// служит телефон в формате 7XXXXXXXXXX или e-mail. Ответ — пара JWT;
// access живёт двое суток, refresh — три месяца, и refresh при обновлении
// ротируется, поэтому новый обязателен к сохранению.
//
// Пароль на диск не попадает: он живёт только в аргументе запроса. В файле
// аккаунта лежат токены, точка выдачи и то, что показывает whoami.

import { ProviderError, type Ctx, type Display } from "../../sdk/index.ts"
import { call, fetchGuestToken, type Tokens } from "./api.ts"

export type Account = {
	access?: string
	refresh?: string
	/** unix-секунды, из клейма exp access-токена */
	expires?: number
	guest?: { token: string; expires: number }
	/** сбытовая организация: 4000 — Россия, 2000 — Беларусь, 8000 — Казахстан */
	vkorg: string
	/** точка выдачи: от неё зависят цены, сроки и наличие в выдаче поиска */
	vstel: string
	display?: Display
}

export const DEFAULT_VKORG = "4000"
/** «Москва МКАД 86 км» — точка по умолчанию из бандла фронта. */
export const DEFAULT_VSTEL = "ME86"

export const emptyAccount = (): Account => ({ vkorg: DEFAULT_VKORG, vstel: DEFAULT_VSTEL })

const now = (): number => Math.floor(Date.now() / 1000)

/**
 * Клеймы JWT. Подпись не проверяем: токен пришёл от сервера по TLS и лежит в
 * файле с правами 600, а читаем мы его только ради срока жизни.
 */
export type Claims = {
	exp?: number
	data?: { login?: string; utype?: string; clientId?: string; clientSapId?: number }
}

export function decodeClaims(token: string): Claims | null {
	const part = token.split(".")[1]
	if (!part) return null
	try {
		// не atob: он отдаёт байты как Latin-1 и портит кириллицу в клеймах
		return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Claims
	} catch {
		return null
	}
}

/** Срок жизни токена по его клейму; час — запасной вариант для токена без exp. */
export const expiresOf = (token: string): number => decodeClaims(token)?.exp ?? now() + 3600

// --- гостевой токен -------------------------------------------------------

/**
 * Гостевой токен для команд без входа. Кэшируется в файле аккаунта: он живёт
 * около года, а брать новый на каждый вызов — лишний запрос к сайту.
 */
export async function guestToken(ctx: Ctx<Account>): Promise<string> {
	const a = ctx.account ?? emptyAccount()
	if (a.guest && a.guest.expires - 60 > now()) return a.guest.token
	const t = await fetchGuestToken()
	const guest = { token: t.accessToken, expires: expiresOf(t.accessToken) }
	await ctx.saveAccount({ ...a, guest })
	return guest.token
}

// --- вход и обновление ----------------------------------------------------

/** Живой access-токен; молча обновляет протухший. Без входа — ошибка `auth`. */
export async function accessToken(ctx: Ctx<Account>): Promise<string> {
	const a = ctx.account
	if (!a?.access || !a.refresh) throw new ProviderError("auth", "нужен вход: adoc-armtek login")
	if ((a.expires ?? 0) - 60 > now()) return a.access

	let t: Tokens
	try {
		t = await call<Tokens>("auth-microservice/v1/auth/refresh", { method: "POST", body: {}, token: a.refresh })
	} catch (e) {
		// Отозванный refresh не чинится повтором: держать негодный файл значит
		// вечно повторять ошибку сервера вместо внятного «войди заново».
		if (e instanceof ProviderError && e.code === "auth") {
			await ctx.saveAccount({ ...a, access: undefined, refresh: undefined, expires: undefined })
			throw new ProviderError("auth", "вход протух, нужен повторный login")
		}
		throw e
	}
	const next: Account = {
		...a,
		access: t.accessToken,
		// сервер ротирует refresh; не сохранить новый — потерять вход
		refresh: t.refreshToken ?? a.refresh,
		expires: expiresOf(t.accessToken),
	}
	await ctx.saveAccount(next)
	return t.accessToken
}

// --- профиль --------------------------------------------------------------

export type ClientData = {
	FIRST_NAME?: string
	MIDDLE_NAME?: string
	LAST_NAME?: string
	EMAILS?: { EMAIL?: string; MAIN?: boolean }[]
	PHONES?: { PHONE_NUMBER_FULL?: string; MAIN?: boolean }[]
	VSTEL?: string
	VSTEL_DATA?: { vstel?: string; vkorg?: string }
}

export const fetchClient = (token: string): Promise<ClientData> =>
	call<ClientData>("client-microservice/v1/client/individual/get-client", { token })

const main = <T extends { MAIN?: boolean }>(list: T[] | undefined): T | undefined =>
	list?.find(x => x.MAIN) ?? list?.[0]

/** Что показывает whoami. Телефон и почта — как есть, без маскирования. */
export function displayOf(c: ClientData, fallbackName: string): Display {
	const name = [c.LAST_NAME, c.FIRST_NAME, c.MIDDLE_NAME].filter(s => s?.trim()).join(" ").trim()
	const email = main(c.EMAILS)?.EMAIL
	const phone = main(c.PHONES)?.PHONE_NUMBER_FULL
	return {
		name: name || fallbackName,
		...(email ? { email } : {}),
		...(phone ? { phone: phone.startsWith("+") ? phone : `+${phone}` } : {}),
	}
}

/** Точка выдачи и сбытовая организация аккаунта — от них зависят цены. */
export function placeOf(c: ClientData): { vkorg?: string; vstel?: string } {
	return { vkorg: c.VSTEL_DATA?.vkorg, vstel: c.VSTEL_DATA?.vstel ?? c.VSTEL }
}

// --- login ----------------------------------------------------------------

/**
 * Логин и пароль берутся из ARMTEK_PHONE/ARMTEK_PASSWORD, когда заданы обе
 * переменные (неинтерактивный путь), иначе спрашиваются в терминале. Из argv
 * пароль не принимается принципиально: он осел бы в истории оболочки.
 */
export async function login(ctx: Ctx<Account>): Promise<{ account: Account; display: Display }> {
	const env = process.env.ARMTEK_PHONE && process.env.ARMTEK_PASSWORD
		? { login: process.env.ARMTEK_PHONE, password: process.env.ARMTEK_PASSWORD }
		: null
	const userLogin = env?.login ?? await ctx.prompt("Телефон (7XXXXXXXXXX) или e-mail > ")
	const password = env?.password ?? await ctx.secret("Пароль > ")
	if (!userLogin || !password) throw new ProviderError("bad_args", "нужны логин и пароль")

	let t: Tokens
	try {
		t = await call<Tokens>("auth-microservice/v1/auth/login", { body: { login: userLogin, password } })
	} catch (e) {
		// Сайт на неверную пару отвечает 401 с пустым arr_messages, так что
		// внятный текст остаётся сочинить здесь.
		if (e instanceof ProviderError && e.code === "auth") throw new ProviderError("auth", "Логин или пароль не подошли")
		throw e
	}
	if (!t.refreshToken) throw new ProviderError("internal", "armtek не вернул refreshToken")

	const base = ctx.account ?? emptyAccount()
	const account: Account = {
		...base,
		access: t.accessToken,
		refresh: t.refreshToken,
		expires: expiresOf(t.accessToken),
	}

	// Профиль нужен и для whoami, и ради точки выдачи аккаунта: она задаёт
	// цены и сроки, а по умолчанию мы взяли бы московскую.
	const client = await fetchClient(t.accessToken)
	const display = displayOf(client, decodeClaims(t.accessToken)?.data?.login ?? userLogin)
	const place = placeOf(client)
	account.display = display
	if (place.vkorg) account.vkorg = place.vkorg
	if (place.vstel) account.vstel = place.vstel
	return { account, display }
}

/** Кто вошёл. Профиль спрашивается у сайта, ответ кладётся в файл аккаунта. */
export async function whoami(ctx: Ctx<Account>): Promise<Display | null> {
	if (!ctx.account?.access) return null
	const token = await accessToken(ctx)
	const client = await fetchClient(token)
	const display = displayOf(client, decodeClaims(token)?.data?.login ?? "armtek")
	const a = ctx.account
	if (a) {
		const place = placeOf(client)
		await ctx.saveAccount({ ...a, display, vkorg: place.vkorg ?? a.vkorg, vstel: place.vstel ?? a.vstel })
	}
	return display
}

// auth.ts — вход в armtek.ru, обновление токенов и содержимое accounts/armtek.json.
//
// Вход — POST auth-microservice/v1/auth/login с {login, password}: логином
// служит телефон в формате 7XXXXXXXXXX или e-mail. Ответ — пара JWT;
// access живёт двое суток, refresh — три месяца, и refresh при обновлении
// ротируется, поэтому новый обязателен к сохранению.
//
// На диск не попадают ни пароль, ни персональные данные: пароль живёт только
// в аргументе запроса, а имя, почта и телефон каждый раз спрашиваются у сайта.
// В файле аккаунта — токены, сбытовая организация, точка выдачи и коды
// клиента, нужные корзине и гаражу.

import { ProviderError, decodeClaims as jwtClaims, type Ctx, type Display } from "../../sdk/index.ts"
import * as api from "./api.ts"
import { DEFAULT_VKORG, DEFAULT_VSTEL, type ClientData, type Tokens } from "./api.ts"

export type { ClientData }

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
	/** hex32 из клеймов токена; им запрашивается гараж */
	clientId?: string
	/** ADDITIONAL.CLIENT_CATEGORY и CLIENT_SEGMENT — параметры листинга корзины */
	category?: string
	segment?: string
}

export const emptyAccount = (): Account => ({ vkorg: DEFAULT_VKORG, vstel: DEFAULT_VSTEL })

const now = (): number => Math.floor(Date.now() / 1000)

/**
 * Клеймы JWT. Подпись не проверяем: токен пришёл от сервера по TLS и лежит в
 * файле с правами 600, а читаем мы его только ради срока жизни и clientId.
 */
export type Claims = {
	exp?: number
	data?: { login?: string; utype?: string; clientId?: string; clientSapId?: number }
}

export const decodeClaims = (token: string): Claims | null => jwtClaims<Claims>(token)

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
	const t = await api.fetchGuestToken()
	const guest = { token: t.accessToken, expires: expiresOf(t.accessToken) }
	await ctx.saveAccount({ ...a, guest })
	return guest.token
}

/** Токен для чтения: пользовательский, если вошли, иначе гостевой. */
export const readToken = (ctx: Ctx<Account>): Promise<string> =>
	ctx.account?.access ? accessToken(ctx) : guestToken(ctx)

/**
 * Публичное чтение — поиск, бренды, предложения, карточка, аналоги, отзывы,
 * точки выдачи. Идёт с токеном вошедшего: цена, срок и наличие у армтека
 * зависят от договора, и подменять их гостевыми молча нельзя.
 *
 * Но сайт умеет ограничить именно аккаунт: тот же запрос с гостевым токеном
 * отвечает данными, а с аккаунтным — 429 с капчей (проверено вживую). Тогда
 * ровно один повтор гостевым и строка в stderr: без неё человек решил бы, что
 * видит свои цены. Повтор безопасен — это чтение, и оно идемпотентно.
 *
 * Гостя, которого ограничили, повторять нечем: у него второго токена нет.
 */
export async function publicRead<T>(ctx: Ctx<Account>, run: (token: string) => Promise<T>): Promise<T> {
	const own = !!ctx.account?.access
	try {
		return await run(own ? await accessToken(ctx) : await guestToken(ctx))
	} catch (e) {
		if (!own || !api.isThrottled(e)) throw e
		ctx.warn("armtek: аккаунт ограничен сайтом, цены показаны как для гостя")
		return await run(await guestToken(ctx))
	}
}

// --- вход и обновление ----------------------------------------------------

/** Живой access-токен; молча обновляет протухший. Без входа — ошибка `auth`. */
export async function accessToken(ctx: Ctx<Account>): Promise<string> {
	const a = ctx.account
	if (!a?.access || !a.refresh) throw new ProviderError("auth", "нужен вход: adoc-armtek login")
	if ((a.expires ?? 0) - 60 > now()) return a.access

	// Ровно одна попытка: refresh протухает целиком, повтор дал бы тот же 401
	// и превратил бы внятную ошибку в задержку.
	let t: Tokens
	try {
		t = await api.postRefresh(a.refresh)
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

/** Точка выдачи, сбытовая организация и коды клиента из карточки. */
export function placeOf(c: ClientData): Partial<Account> {
	const out: Partial<Account> = {}
	const vkorg = c.VSTEL_DATA?.vkorg
	const vstel = c.VSTEL_DATA?.vstel ?? c.VSTEL
	if (vkorg) out.vkorg = vkorg
	if (vstel) out.vstel = vstel
	if (c.CLIENT_ID) out.clientId = c.CLIENT_ID
	if (c.ADDITIONAL?.CLIENT_CATEGORY) out.category = c.ADDITIONAL.CLIENT_CATEGORY
	if (c.ADDITIONAL?.CLIENT_SEGMENT) out.segment = c.ADDITIONAL.CLIENT_SEGMENT
	return out
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
		t = await api.postLogin(userLogin, password)
	} catch (e) {
		// Сайт на неверную пару отвечает 401 с пустым arr_messages, так что
		// внятный текст остаётся сочинить здесь.
		if (e instanceof ProviderError && e.code === "auth") throw new ProviderError("auth", "Логин или пароль не подошли")
		throw e
	}
	if (!t.refreshToken) throw new ProviderError("internal", "armtek не вернул refreshToken")

	const claims = decodeClaims(t.accessToken)
	const account: Account = {
		...(ctx.account ?? emptyAccount()),
		access: t.accessToken,
		refresh: t.refreshToken,
		expires: expiresOf(t.accessToken),
		...(claims?.data?.clientId ? { clientId: claims.data.clientId } : {}),
	}

	// Профиль нужен и для whoami, и ради точки выдачи аккаунта: она задаёт
	// цены и сроки, а по умолчанию мы взяли бы московскую.
	const client = await api.fetchClient(t.accessToken, account.vkorg)
	return { account: { ...account, ...placeOf(client) }, display: displayOf(client, claims?.data?.login ?? userLogin) }
}

/** Кто вошёл. Профиль спрашивается у сайта; в файл едут только коды, не ПДн. */
export async function whoami(ctx: Ctx<Account>): Promise<Display | null> {
	if (!ctx.account?.access) return null
	const token = await accessToken(ctx)
	const a = ctx.account
	const client = await api.fetchClient(token, a?.vkorg)
	if (a) await ctx.saveAccount({ ...a, ...placeOf(client) })
	return displayOf(client, decodeClaims(token)?.data?.login ?? "armtek")
}

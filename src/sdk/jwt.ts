// jwt.ts — чтение клеймов JWT без проверки подписи.

/**
 * Клеймы из токена. Подпись не проверяется намеренно: токен пришёл от сервера
 * по TLS и лежит в файле с правами 600, а читаем мы его только ради срока
 * жизни и того, что показать человеку, — решений о доступе на этом не
 * принимается. Форму клеймов задаёт провайдер параметром типа: у каждого
 * сайта она своя.
 */
export function decodeClaims<T = Record<string, unknown>>(token: string): T | null {
	const part = token.split(".")[1]
	if (!part) return null
	try {
		// не atob: он отдаёт байты как Latin-1 и портит кириллицу в именах
		return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T
	} catch {
		return null
	}
}

// provider.ts — объявление провайдера armtek для SDK.
//
// Готовы вход, выход и whoami; поиск, бренды, предложения, отзывы, корзина и
// гараж делаются следующим заходом — карта их эндпоинтов уже снята и лежит в
// docs/armtek-api.md. Контракт требует три метода поиска, поэтому они здесь
// заглушками: соврать пустой выдачей хуже, чем честно сказать «пока нет».

import { ProviderError, defineProvider } from "../../sdk/index.ts"
import { mapHttpError } from "./api.ts"
import { login, whoami, type Account } from "./auth.ts"

const notYet = (what: string): never => {
	throw new ProviderError("internal", `armtek: ${what} ещё не реализован`)
}

export const armtek = defineProvider<Account, []>({
	id: "armtek",
	name: "Armtek",
	site: "https://armtek.ru",
	capabilities: [],
	mapError: mapHttpError,

	login,
	whoami,
	search: async () => notYet("поиск по названию"),
	brands: async () => notYet("список брендов"),
	offers: async () => notYet("список предложений"),
})

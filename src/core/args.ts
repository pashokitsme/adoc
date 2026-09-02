// args.ts — аргументы команд обёртки. Числа, JSON и обязательные позиционные
// разбирает sdk/cli.ts: у обёртки и у провайдера должны совпадать не только
// правила, но и тексты ошибок. Здесь остаётся то, чего в SDK нет: значения по
// умолчанию и поиск провайдера по имени.

import { ProviderError, TOOL, brandKey, intFlag, need, positiveInt } from "../sdk/index.ts"
import type { Capability, Flags } from "../sdk/index.ts"
import type { Ctx } from "./ctx.ts"
import type { Provider } from "./registry.ts"

export const limitOf = (flags: Flags, def = 30): number => (flags.limit === undefined ? def : positiveInt("--limit", flags.limit))
export const pageOf = (flags: Flags): number => (flags.page === undefined ? 1 : positiveInt("--page", flags.page))

/**
 * Бренд команды: вторым словом или флагом. Обе формы обязаны идти одной
 * дорогой — четыре копии этого выражения по командам уже начинали расходиться,
 * а разойдясь, дали бы `part N1 FAG` и `part N1 --brand FAG` разные ответы.
 *
 * Названы обе и по-разному — это не «одна победила»: человек хотел двух разных
 * брендов сразу, и молча выбрать один значит показать не то, что просили.
 */
export function brandOf(ctx: { args: string[]; flags: Flags }): string | undefined {
	const flag = typeof ctx.flags.brand === "string" ? ctx.flags.brand : undefined
	const word = ctx.args[1]
	if (word && flag && brandKey(word) !== brandKey(flag)) {
		throw new ProviderError("bad_args", `бренд назван дважды и по-разному: «${word}» и --brand «${flag}»`)
	}
	return word ?? flag
}

/** Количество для корзины: целое ≥ 0, по умолчанию одна штука. */
export const qtyOf = (flags: Flags): number => intFlag("qty", flags.qty) ?? 1

/** Перечисление известных имён в тексте ошибки: без него «нет такого» бесполезно. */
export const listing = (ids: string[]): string => ids.join(", ") || "ни одного"

/** Один провайдер по имени: для login/logout и адресных команд корзины. */
export async function one(ctx: Ctx, id: string | undefined, cap?: Capability): Promise<Provider> {
	const name = need(id, `имя провайдера — список: ${TOOL} providers`)
	const { ok } = await ctx.load()
	const p = ok.find(x => x.id === name)
	if (!p) throw new ProviderError("bad_args", `нет провайдера «${name}» — есть ${listing(ok.map(x => x.id))}`)
	if (cap && !p.describe.capabilities.includes(cap)) throw new ProviderError("bad_args", `${name} не умеет ${cap}`)
	return p
}

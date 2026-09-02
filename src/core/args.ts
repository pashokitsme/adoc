// args.ts — аргументы команд обёртки. Числа, JSON и обязательные позиционные
// разбирает sdk/cli.ts: у обёртки и у провайдера должны совпадать не только
// правила, но и тексты ошибок. Здесь остаётся то, чего в SDK нет: значения по
// умолчанию и поиск провайдера по имени.

import { ProviderError, TOOL, intFlag, need, positiveInt } from "../sdk/index.ts"
import type { Capability, Flags } from "../sdk/index.ts"
import type { Ctx } from "./ctx.ts"
import type { Provider } from "./registry.ts"

export const limitOf = (flags: Flags, def = 30): number => (flags.limit === undefined ? def : positiveInt("--limit", flags.limit))
export const pageOf = (flags: Flags): number => (flags.page === undefined ? 1 : positiveInt("--page", flags.page))

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

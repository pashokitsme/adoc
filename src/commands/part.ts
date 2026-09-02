// part.ts — главная команда. Порядок жёсткий и тот же, что у провайдера:
// сначала бренд (шаг brands), потом предложения (шаг offers). Каждому сайту
// уходит его собственное написание бренда — нормализация нужна обёртке для
// склейки, а сайту она чужая.

import { TOOL, bold, cyan, dim, heading, need, renderOffers } from "../sdk/index.ts"
import { limitOf } from "../core/args.ts"
import { emptyResult, resolveBrand } from "../core/brand.ts"
import { invoke } from "../core/invoke.ts"
import { saveLastPart } from "../core/lastpart.ts"
import { splitOffers } from "../core/merge.ts"
import { fanout, report } from "../core/partial.ts"
import { cut, hint, providerCol } from "../core/render.ts"
import { parseOffers } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdPart(ctx: Ctx): Promise<Output> {
	const article = need(ctx.args[0], "артикул")
	// Бренд пишут и вторым словом, и флагом: подсказка после «уточни бренд»
	// зовёт --brand, а руками чаще набирают просто «adoc part N123 VAG».
	const wanted = ctx.args[1] ?? (typeof ctx.flags.brand === "string" ? ctx.flags.brand : undefined)
	const providers = await ctx.pick()
	// Бросает Ambiguous — её ловит и рисует app.ts.
	const resolved = await resolveBrand(providers, article, wanted, ctx.warn)
	const { brand, all, failures } = resolved

	if (!brand) return emptyResult(article, resolved, { brands: [], offers: [], analogs: [] }, ctx.warn)

	const brandsJson = all.map(b => ({
		brand: b.brand, article: b.article,
		...(b.name ? { name: b.name } : {}), ...(b.rating ? { rating: b.rating } : {}),
		providers: b.providers,
	}))

	// Спрашиваем только тех, у кого этот бренд есть: остальным вопрос
	// бессмысленен и стоил бы лишних секунд ожидания.
	const holders = providers.filter(p => brand.providers.includes(p.id))
	const analogs = ctx.flags.analogs === true
	const f = await fanout(
		holders,
		// id — чтобы наши собственные отказы («не ответил за 30000 мс») называли
		// провайдера, а не `bun`, которым он случайно запускается.
		p => invoke(p.bin, ["offers", article, "--brand", brand.spelling[p.id]!, ...(analogs ? ["--analogs"] : [])], { id: p.id }),
		parseOffers,
		ctx.warn,
	)

	const split = splitOffers(article, f.got.map(g => ({ provider: g.provider, items: g.value })))
	const limit = limitOf(ctx.flags)
	const exact = split.offers.slice(0, limit)
	const extra = analogs ? split.analogs.slice(0, limit) : []

	const rows = [...exact, ...extra]
	const code = report(f, failures, ctx.warn)
	// Номера строк в таблице и в кэше — одни и те же, иначе `basket add 3`
	// положил бы в корзину не то, что человек прочитал. И кэш перезаписывает
	// только удавшаяся таблица: упавший шаг offers иначе затёр бы вчерашние
	// строки пустотой, и `basket add 1` перестал бы работать на ровном месте.
	if (code === 0 && rows.length) await saveLastPart(article, brand.brand, rows)

	return {
		json: {
			article, brand: brand.brand, brands: brandsJson,
			offers: exact, analogs: extra, errors: [...failures, ...f.failures],
		},
		code,
		render: () => {
			const out = [
				`${cyan(article)} · ${bold(brand.brand)} · ${dim(brand.providers.join(", "))}`,
				"",
				renderOffers(exact, [providerCol]),
			]
			out.push(...cut(exact.length, split.offers.length))
			if (analogs) {
				out.push(heading("Аналоги"), extra.length ? renderOffers(extra, [providerCol], exact.length + 1) : dim("аналогов нет"))
				out.push(...cut(extra.length, split.analogs.length))
			} else if (split.analogs.length) {
				out.push(hint("есть и аналоги — --analogs"))
			}
			// Под «предложений нет» подсказка про номер строки не к чему: номеров нет.
			if (rows.length) out.push(hint(`${TOOL} basket add <#> [--qty <n>] — положить строку в корзину её сайта`))
			return out.join("\n")
		},
	}
}

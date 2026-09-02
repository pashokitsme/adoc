// crosses.ts — справочник номеров: чем ещё называется этот же узел. Это не
// выдача и не цены: по найденному номеру идут в `part`. Отличие от `analogs`
// в том же: `analogs` показывает предложения заменителей, а здесь — сами
// номера, включая те, которых ни у кого нет в наличии.

import { TOOL, cyan, bold, dim, need, renderCrosses } from "../sdk/index.ts"
import { brandOf, limitOf } from "../core/args.ts"
import { emptyResult, resolveBrand } from "../core/brand.ts"
import { invoke } from "../core/invoke.ts"
import { mergeCrosses, type MergedCross } from "../core/merge.ts"
import { fanout, report } from "../core/partial.ts"
import { cut, tips, whereCol } from "../core/render.ts"
import { parseCrosses } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdCrosses(ctx: Ctx): Promise<Output> {
	const article = need(ctx.args[0], "артикул")
	const wanted = brandOf(ctx)
	const all = await ctx.pick()
	// Сайт без кросс-ссылок не спрашивается, но промолчать о нём нельзя.
	const providers = await ctx.pick("crosses")
	const skipped = all.filter(p => !providers.some(x => x.id === p.id))
	if (skipped.length) ctx.warn(dim(`кросс-ссылок не умеют, не спрашиваем: ${skipped.map(p => p.id).join(", ")}`))

	// Бросает Ambiguous — её ловит и рисует app.ts.
	const resolved = await resolveBrand(providers, article, wanted, ctx.warn)
	const { brand, failures } = resolved
	if (!brand) return emptyResult(article, resolved, { crosses: [] }, ctx.warn)

	const holders = providers.filter(p => brand.providers.includes(p.id))
	const f = await fanout(
		holders,
		// id — чтобы наши собственные отказы называли провайдера, а не `bun`.
		p => invoke(p.bin, ["crosses", article, "--brand", brand.spelling[p.id]!], { id: p.id }),
		parseCrosses,
		ctx.warn,
	)

	const merged = mergeCrosses(f.got.map(g => ({ provider: g.provider, items: g.value })))
	const limit = limitOf(ctx.flags)
	const items = merged.slice(0, limit)
	const code = report(f, failures, ctx.warn)

	return {
		json: { article, brand: brand.brand, crosses: items, total: merged.length, errors: [...failures, ...f.failures] },
		code,
		render: () => [
			`${cyan(article)} · ${bold(brand.brand)} · ${dim(brand.providers.join(", "))} · ${dim("кросс-ссылки")}`,
			"",
			renderCrosses(items, [whereCol<MergedCross>()]),
			...cut(items.length, merged.length),
			...tips(items.length
				? [`${TOOL} part <артикул> <бренд> — цены и сроки по найденному номеру`]
				: []),
		].join("\n"),
	}
}

// info.ts — карточка артикула у каждого сайта: цена «от», срок, оценка,
// склады, описание и, главное, адрес самой карточки. Одной таблицей это не
// сводится — сайты показывают разное, и общий знаменатель у них слишком
// беден. Поэтому здесь блок на сайт, как у reviews.

import { need, renderInfo } from "../sdk/index.ts"
import { brandOf, limitOf } from "../core/args.ts"
import { emptyResult, resolveBrand } from "../core/brand.ts"
import { invoke } from "../core/invoke.ts"
import { allFailed, fanout, report } from "../core/partial.ts"
import { blockTitle } from "../core/render.ts"
import { parseInfo } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdInfo(ctx: Ctx): Promise<Output> {
	const article = need(ctx.args[0], "артикул")
	// Бренд пишут и вторым словом, и флагом — как у part и reviews.
	const wanted = brandOf(ctx)
	const providers = await ctx.pick()

	// Бросает Ambiguous — её ловит и рисует app.ts.
	const resolved = await resolveBrand(providers, article, wanted, ctx.warn)
	const { brand, failures } = resolved
	if (!brand) return emptyResult(article, resolved, { providers: {} }, ctx.warn)

	// Спрашиваем только тех, у кого этот бренд есть: остальным вопрос
	// бессмысленен и стоил бы лишних секунд ожидания.
	const holders = providers.filter(p => brand.providers.includes(p.id))
	const f = await fanout(
		holders,
		// id — чтобы наши собственные отказы называли провайдера, а не `bun`.
		p => invoke(p.bin, ["info", article, "--brand", brand.spelling[p.id]!], { id: p.id }),
		parseInfo,
		ctx.warn,
	)
	const code = report(f, failures, ctx.warn)
	// Предложения режутся тем же --limit, что и таблицы part: у autodoc их
	// на популярный артикул несколько десятков, и карточка утонула бы в них.
	const limit = limitOf(ctx.flags)

	return {
		json: {
			article, brand: brand.brand,
			providers: Object.fromEntries(f.got.map(g => [g.provider, g.value])),
			errors: [...failures, ...f.failures],
		},
		code,
		render: () => f.got.length
			// Карточку целиком рисует SDK: у провайдера и у обёртки она обязана
			// выглядеть одинаково. Обёртка добавляет только имя сайта.
			? f.got.map(g => `\n${blockTitle(g.provider)}\n${renderInfo(g.value.info, g.value.offers.slice(0, limit))}`).join("\n")
			: allFailed(f) ? "ни один сайт не ответил" : "карточки нет",
	}
}

// search.ts — поиск по названию. Сам по себе он не про цену: из его выдачи
// берут артикул с брендом и идут в `part`, где цены и сроки.

import { TOOL, need, renderProducts } from "../sdk/index.ts"
import { limitOf, pageOf } from "../core/args.ts"
import { invoke } from "../core/invoke.ts"
import { mergeProducts, type MergedProduct } from "../core/merge.ts"
import { fanout, report } from "../core/partial.ts"
import { cut, hint, whereCol } from "../core/render.ts"
import { parseProducts } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdSearch(ctx: Ctx): Promise<Output> {
	// Запрос из нескольких слов приходит несколькими аргументами.
	const query = need(ctx.args.join(" ").trim() || undefined, "текст запроса")
	const providers = await ctx.pick()
	const limit = limitOf(ctx.flags)
	const page = pageOf(ctx.flags)

	const f = await fanout(
		providers,
		// Страницу и размер отдаём сайтам: листает каждый у себя, склейка
		// второй раз по страницам не режет — только по --limit, иначе строка
		// исчезала бы из выдачи дважды и незаметно.
		// id — чтобы наши собственные отказы называли провайдера, а не `bun`.
		p => invoke(p.bin, ["search", query, "--page", String(page), "--limit", String(limit)], { id: p.id }),
		parseProducts,
		ctx.warn,
	)
	// Сначала то, что есть у большего числа сайтов: такой товар легче купить.
	const merged = mergeProducts(f.got.map(g => ({ provider: g.provider, items: g.value })))
	const items = merged.slice(0, limit)
	const code = report(f, [], ctx.warn)

	return {
		json: { query, items, total: merged.length, errors: f.failures },
		code,
		render: () => [
			renderProducts(items, [whereCol<MergedProduct>()]),
			...cut(items.length, merged.length),
			hint(`${TOOL} part <артикул> <бренд> — цены, сроки и наличие по строке`),
		].join("\n"),
	}
}

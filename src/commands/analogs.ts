// analogs.ts — заменители артикула одной таблицей, сложенной из всех сайтов.
// От `part --analogs` отличается тем, что здесь только аналоги и весь --limit
// достаётся им: `part` показывает их довеском к точным предложениям, а сюда
// приходят, когда точное уже не устроило (дорого, нет в наличии, долго).

import { TOOL, bold, cyan, dim, need, renderOffers } from "../sdk/index.ts"
import { limitOf } from "../core/args.ts"
import { emptyResult, resolveBrand } from "../core/brand.ts"
import { invoke } from "../core/invoke.ts"
import { saveLastPart } from "../core/lastpart.ts"
import { splitOffers } from "../core/merge.ts"
import { fanout, report } from "../core/partial.ts"
import { cut, hint, providerCol } from "../core/render.ts"
import { parseOffers } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdAnalogs(ctx: Ctx): Promise<Output> {
	const article = need(ctx.args[0], "артикул")
	// Бренд пишут и вторым словом, и флагом — как у part и reviews.
	const wanted = ctx.args[1] ?? (typeof ctx.flags.brand === "string" ? ctx.flags.brand : undefined)
	const providers = await ctx.pick()

	// Бросает Ambiguous — её ловит и рисует app.ts.
	const resolved = await resolveBrand(providers, article, wanted, ctx.warn)
	const { brand, failures } = resolved
	if (!brand) {
		const empty = emptyResult(article, resolved, { analogs: [] }, ctx.warn)
		// Номера строк этой таблицы — те же номера для `basket add`, поэтому и
		// обнуляется кэш здесь по тем же правилам, что у `part`.
		if (empty.code === 0) await saveLastPart(article, wanted ?? "", [])
		return empty
	}

	const holders = providers.filter(p => brand.providers.includes(p.id))
	const f = await fanout(
		holders,
		// id — чтобы наши собственные отказы называли провайдера, а не `bun`.
		p => invoke(p.bin, ["analogs", article, "--brand", brand.spelling[p.id]!], { id: p.id }),
		parseOffers,
		ctx.warn,
	)

	// Команда обещает только заменители, но сайт мог положить в ответ и точное
	// совпадение: splitOffers отделяет их тем же правилом, что у `part`, и
	// точные строки сюда не попадают.
	const split = splitOffers(article, f.got.map(g => ({ provider: g.provider, items: g.value })))
	const limit = limitOf(ctx.flags)
	const rows = split.analogs.slice(0, limit)
	const code = report(f, failures, ctx.warn)
	// Строки те же, что у `part`, и номера в них те же: `basket add <#>`
	// работает и по этой таблице. Кэш пишет только удавшийся запуск.
	if (code === 0) await saveLastPart(article, brand.brand, rows)

	return {
		json: { article, brand: brand.brand, analogs: rows, errors: [...failures, ...f.failures] },
		code,
		render: () => [
			`${cyan(article)} · ${bold(brand.brand)} · ${dim(brand.providers.join(", "))} · ${dim("аналоги")}`,
			"",
			renderOffers(rows, [providerCol]),
			...cut(rows.length, split.analogs.length),
			...(rows.length ? ["", hint(`${TOOL} basket add <#> [--qty <n>] — положить строку в корзину её сайта`)] : []),
		].join("\n"),
	}
}

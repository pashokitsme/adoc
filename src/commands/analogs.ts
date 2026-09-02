// analogs.ts — заменители артикула одной таблицей, сложенной из всех сайтов.
// От `part --analogs` отличается тем, что здесь только аналоги и весь --limit
// достаётся им: `part` показывает их довеском к точным предложениям, а сюда
// приходят, когда точное уже не устроило (дорого, нет в наличии, долго).

import { TOOL, bold, cyan, dim, renderOffers } from "../sdk/index.ts"
import { brandOf, limitOf } from "../core/args.ts"
import { articlesOf, runBatch, type BatchItem, type Section } from "../core/batch.ts"
import { emptyResult, resolveBrand } from "../core/brand.ts"
import { invoke } from "../core/invoke.ts"
import { saveLastPart } from "../core/lastpart.ts"
import { siteTotal, splitOffers } from "../core/merge.ts"
import { fanout, report } from "../core/partial.ts"
import { cut, hint, providerCol } from "../core/render.ts"
import { parseOffers } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"
import type { Provider } from "../core/registry.ts"
import { basketTail } from "./part.ts"

/** Короткий список — повод объяснить, что именно ищет команда. */
const FEW = 5

async function oneAnalogs(ctx: Ctx, providers: Provider[], it: BatchItem, batch: boolean): Promise<Section> {
	const { article } = it
	const wanted = it.brand
	// Бросает Ambiguous — её ловит и рисует app.ts, а в списке — драйвер.
	const resolved = await resolveBrand(providers, article, wanted, ctx.warn)
	const { brand, failures } = resolved
	if (!brand) {
		const empty = emptyResult(article, resolved, { analogs: [] }, ctx.warn)
		// Номера строк этой таблицы — те же номера для `basket add`, поэтому и
		// обнуляется кэш здесь по тем же правилам, что у `part`.
		if (empty.code === 0) await saveLastPart(article, wanted ?? "", [])
		return { article, json: empty.json as Record<string, unknown>, code: empty.code ?? 0, render: empty.render, rows: [], errors: failures }
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
	const split = splitOffers(article, f.got.map(g => ({ provider: g.provider, items: g.value.items })))
	const limit = limitOf(ctx.flags)
	const rows = split.analogs.slice(0, limit)
	// Итог сайтов относится ко всему их ответу, а он здесь весь из аналогов:
	// armtek отдаёт страницу из 43, а всего их у него 575.
	const site = siteTotal(f.got.map(g => g.value))
	const code = report(f, failures, ctx.warn)
	// Строки те же, что у `part`, и номера в них те же: `basket add <#>`
	// работает и по этой таблице. Кэш пишет только удавшийся запуск.
	if (code === 0) await saveLastPart(article, brand.brand, rows)

	return {
		article,
		rows,
		errors: [...failures, ...f.failures],
		json: { article, brand: brand.brand, analogs: rows, errors: [...failures, ...f.failures] },
		code,
		render: () => [
			`${cyan(article)} · ${bold(brand.brand)} · ${dim(brand.providers.join(", "))} · ${dim("аналоги")}`,
			"",
			// Пометку «аналог» рендер SDK ставит каждой такой строке, а здесь
			// такие все: колонка повторяла бы заголовок таблицы сверху вниз.
			// В --json пометка остаётся — там она несёт смысл.
			// Пустая таблица говорит своими словами: «предложений нет» из SDK
			// здесь не про то — предложения-то есть, их показывает `part`.
			rows.length ? renderOffers(rows.map(o => ({ ...o, analog: false })), [providerCol]) : "заменителей нет",
			...cut(rows.length, split.analogs.length, site),
			// Что это за список, видно не сразу: сайты зовут аналогами замены по
			// номеру — тот же узел под другим номером. Деталь той же функции
			// другого производителя ищется не по номеру, а по названию под
			// машину, и под коротким списком об этом надо сказать вслух.
			...(rows.length < FEW ? ["", hint(`это замены по номеру; аналоги по функции — ${TOOL} search "<название детали>" под машиной гаража`)] : []),
			...(rows.length && !batch ? ["", hint(`${TOOL} basket add <#> [--qty <n>] — положить строку в корзину её сайта`)] : []),
		].join("\n"),
	}
}

export async function cmdAnalogs(ctx: Ctx): Promise<Output> {
	// Бренд пишут и вторым словом, и флагом — как у part и reviews.
	const items = await articlesOf(ctx, brandOf(ctx))
	const providers = await ctx.pick()
	return await runBatch(ctx, items, (it, batch) => oneAnalogs(ctx, providers, it, batch), basketTail)
}

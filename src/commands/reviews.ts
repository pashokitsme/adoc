// reviews.ts — оценки и отзывы. Шаг определения бренда тот же, что у part:
// отзывы привязаны к производителю, а не к номеру детали. Спрашиваются только
// сайты с capability reviews — и только те, у кого этот бренд нашёлся.

import { dim, need, renderReviews } from "../sdk/index.ts"
import { limitOf, pageOf } from "../core/args.ts"
import { emptyResult, resolveBrand } from "../core/brand.ts"
import { invoke } from "../core/invoke.ts"
import { allFailed, fanout, report } from "../core/partial.ts"
import { blockTitle, linkList } from "../core/render.ts"
import { parseReviews } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdReviews(ctx: Ctx): Promise<Output> {
	const article = need(ctx.args[0], "артикул")
	// Бренд пишут и вторым словом, и флагом — как у part: подсказка после
	// «уточни бренд» зовёт --brand, а руками набирают просто вторым словом.
	const wanted = ctx.args[1] ?? (typeof ctx.flags.brand === "string" ? ctx.flags.brand : undefined)
	const all = await ctx.pick()
	// Сайт без отзывов не спрашивается вовсе — в том числе про бренды: его
	// ответ всё равно некуда деть, а лишний вопрос стоит секунд ожидания.
	// Но промолчать о нём нельзя: иначе «отзывы всех сайтов» тихо оказались бы
	// отзывами половины.
	const providers = await ctx.pick("reviews")
	const skipped = all.filter(p => !providers.some(x => x.id === p.id))
	if (skipped.length) ctx.warn(dim(`без отзывов, не спрашиваем: ${skipped.map(p => p.id).join(", ")}`))

	// Бросает Ambiguous — её ловит и рисует app.ts.
	const resolved = await resolveBrand(providers, article, wanted, ctx.warn)
	const { brand, failures } = resolved

	if (!brand) return emptyResult(article, resolved, { providers: {} }, ctx.warn)

	const holders = providers.filter(p => brand.providers.includes(p.id))
	const limit = limitOf(ctx.flags)
	const page = pageOf(ctx.flags)
	const f = await fanout(
		holders,
		// Страницу и размер листает каждый сайт у себя: своей склейки отзывов
		// нет — блоки идут по сайтам, — и резать их второй раз незачем.
		// id — чтобы наши собственные отказы называли провайдера, а не `bun`.
		p => invoke(
			p.bin,
			["reviews", article, "--brand", brand.spelling[p.id]!, "--page", String(page), "--limit", String(limit)],
			{ id: p.id },
		),
		parseReviews,
		ctx.warn,
	)
	const code = report(f, failures, ctx.warn)

	return {
		json: {
			article, brand: brand.brand,
			providers: Object.fromEntries(f.got.map(g => [g.provider, g.value])),
			errors: [...failures, ...f.failures],
		},
		code,
		// Оценка у каждого сайта своя и остаётся своей: средним по сайтам
		// пришлось бы складывать разные выборки разных покупателей, и вышло бы
		// число, которого нет ни у кого.
		render: () => f.got.length
			? f.got.map(g => [
				// Адрес страницы отзывов — сразу за именем сайта: за ним и идут.
				`\n${blockTitle(g.provider, `· ${brand.brand} ${article}`, g.value.url)}`,
				renderReviews(g.value),
				// Отзывы в блоке не пронумерованы, поэтому список ссылок называет
				// себя иначе: порядок в нём — порядок отзывов выше.
				...linkList(g.value.items, 1, "ссылки на отзывы"),
			].join("\n")).join("\n")
			: allFailed(f) ? "ни один сайт не ответил" : "отзывов нет",
	}
}

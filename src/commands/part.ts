// part.ts — главная команда. Порядок жёсткий и тот же, что у провайдера:
// сначала бренд (шаг brands), потом предложения (шаг offers). Каждому сайту
// уходит его собственное написание бренда — нормализация нужна обёртке для
// склейки, а сайту она чужая.
//
// Артикулов бывает несколько: `part A,B,C` и `--file <список>` идут через
// core/batch.ts — по артикулу за раз, сайты внутри артикула параллельно.

import { TOOL, bold, cyan, dim, heading, renderOffers } from "../sdk/index.ts"
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

/**
 * Один артикул: бренд, предложения, таблица. `batch` — идёт ли артикул в
 * списке: тогда подсказку про корзину печатает драйвер, один раз внизу, а не
 * каждый раздел своими номерами строк.
 */
async function onePart(ctx: Ctx, providers: Provider[], it: BatchItem, batch: boolean): Promise<Section> {
	const { article } = it
	const analogs = ctx.flags.analogs === true
	// Бросает Ambiguous — её ловит и рисует app.ts, а в списке — драйвер.
	const resolved = await resolveBrand(providers, article, it.brand, ctx.warn)
	const { brand, all, failures } = resolved

	if (!brand) {
		const empty = emptyResult(article, resolved, { brands: [], offers: [], analogs: [] }, ctx.warn)
		// «Ни у кого не нашлось» — тоже ответ по этому артикулу: кэш строк
		// обнуляется, иначе `basket add 1` положил бы строку прошлого артикула.
		// Бренда у такого запуска нет — пишем тот, что просили, или пустой.
		if (empty.code === 0) await saveLastPart(article, it.brand ?? "", [])
		return { article, json: empty.json as Record<string, unknown>, code: empty.code ?? 0, render: empty.render, rows: [], errors: failures }
	}

	const brandsJson = all.map(b => ({
		brand: b.brand, article: b.article,
		...(b.name ? { name: b.name } : {}), ...(b.rating ? { rating: b.rating } : {}),
		providers: b.providers, urls: b.urls,
	}))

	// Спрашиваем только тех, у кого этот бренд есть: остальным вопрос
	// бессмысленен и стоил бы лишних секунд ожидания.
	const holders = providers.filter(p => brand.providers.includes(p.id))
	const f = await fanout(
		holders,
		// id — чтобы наши собственные отказы («не ответил за 30000 мс») называли
		// провайдера, а не `bun`, которым он случайно запускается.
		p => invoke(p.bin, ["offers", article, "--brand", brand.spelling[p.id]!, ...(analogs ? ["--analogs"] : [])], { id: p.id }),
		parseOffers,
		ctx.warn,
	)

	const split = splitOffers(article, f.got.map(g => ({ provider: g.provider, items: g.value.items })))
	const limit = limitOf(ctx.flags)
	const exact = split.offers.slice(0, limit)
	const extra = analogs ? split.analogs.slice(0, limit) : []

	// Итог сайта считает весь его ответ разом. Без --analogs это ровно точные
	// строки — тогда он и подписывается; с --analogs в том же числе сидят и
	// аналоги, и приписать его одной из двух таблиц значило бы соврать обеим.
	const site = analogs ? undefined : siteTotal(f.got.map(g => g.value))
	const rows = [...exact, ...extra]
	const code = report(f, failures, ctx.warn)
	// Номера строк в таблице и в кэше — одни и те же, иначе `basket add 3`
	// положил бы в корзину не то, что человек прочитал. И кэш перезаписывает
	// только удавшаяся таблица: упавший шаг offers иначе затёр бы вчерашние
	// строки пустотой, и `basket add 1` перестал бы работать на ровном месте.
	// Удавшаяся пустая таблица — тоже выдача: кэш обнуляется, чтобы
	// `basket add 1` сказал «строк нет», а не положил строку прошлого артикула.
	// В списке кэш достаётся последнему удавшемуся артикулу — он и называется
	// в подсказке под выдачей.
	if (code === 0) await saveLastPart(article, brand.brand, rows)

	return {
		article,
		rows,
		errors: [...failures, ...f.failures],
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
			out.push(...cut(exact.length, split.offers.length, site))
			if (analogs) {
				out.push(heading("Аналоги"), extra.length ? renderOffers(extra, [providerCol], exact.length + 1) : dim("аналогов нет"))
				out.push(...cut(extra.length, split.analogs.length))
			} else if (split.analogs.length) {
				out.push("", hint(`есть и аналоги — --analogs, или ${TOOL} analogs ${article} ${brand.brand}`))
			}
			// Под «предложений нет» подсказка про номер строки не к чему: номеров нет.
			if (rows.length && !batch) out.push("", hint(`${TOOL} basket add <#> [--qty <n>] — положить строку в корзину её сайта`))
			return out.join("\n")
		},
	}
}

/**
 * Подсказка про корзину под списком: номера строк в кэше — последнего
 * удавшегося артикула, и молчать об этом нельзя. У каждого раздела своя
 * нумерация с единицы, и `basket add 2` без этой строки читался бы как «вторая
 * строка любого из разделов».
 */
export const basketTail = (sections: Section[]): string[] => {
	const last = [...sections].reverse().find(s => s.rows.length && s.code === 0)
	return last ? [hint(`${TOOL} basket add <#> [--qty <n>] — номера таблицы ${last.article}, она в кэше последней`)] : []
}

export async function cmdPart(ctx: Ctx): Promise<Output> {
	// Бренд пишут и вторым словом, и флагом: подсказка после «нужен бренд»
	// зовёт --brand, а руками чаще набирают просто «adoc part N123 VAG».
	const items = await articlesOf(ctx, brandOf(ctx))
	const providers = await ctx.pick()
	return await runBatch(ctx, items, (it, batch) => onePart(ctx, providers, it, batch), basketTail)
}

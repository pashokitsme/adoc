// search.ts — поиск по названию. Сам по себе он не про цену: из его выдачи
// берут артикул с брендом и идут в `part`, где цены и сроки.
//
// Поиск идёт с учётом машины: «фильтр масляный» без автомобиля — это тысячи
// строк, а с ним — те, что подходят. Машина берётся из локального гаража, а
// сайту уходит его собственный идентификатор этой машины (`refs[<сайт>]`,
// его кладёт `garage import`) — свой VIN и свой гараж обёртка никому не
// рассылает.

import { TOOL, dim, need, positiveInt, renderProducts } from "../sdk/index.ts"
import { limitOf, pageOf } from "../core/args.ts"
import { carById, carLabel, loadGarage, mainCar, type GarageCar } from "../core/garage.ts"
import { invoke } from "../core/invoke.ts"
import { mergeProducts, type MergedProduct } from "../core/merge.ts"
import { fanout, report } from "../core/partial.ts"
import { cut, linkList, numCol, tips, whereCol } from "../core/render.ts"
import { parseProducts } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

/**
 * Какая машина участвует в поиске: по умолчанию основная из гаража — к ней
 * запчасть и ищут чаще всего. `--car <id>` берёт другую машину гаража,
 * `--no-car` выключает подбор совсем.
 */
async function chooseCar(ctx: Ctx): Promise<GarageCar | null> {
	if (ctx.flags["no-car"] === true) return null
	const g = await loadGarage()
	if (ctx.flags.car === undefined) return mainCar(g) ?? null
	return carById(g, positiveInt("--car", ctx.flags.car))
}

export async function cmdSearch(ctx: Ctx): Promise<Output> {
	// Запрос из нескольких слов приходит несколькими аргументами.
	const query = need(ctx.args.join(" ").trim() || undefined, "текст запроса")
	const providers = await ctx.pick()
	const limit = limitOf(ctx.flags)
	const page = pageOf(ctx.flags)

	const car = await chooseCar(ctx)
	const refOf = (id: string): Record<string, unknown> | undefined => car?.refs?.[id]
	const used = providers.filter(p => refOf(p.id)).map(p => p.id)
	// Машина в гараже есть, а на этом сайте её нет: он ищет без неё. Молчать
	// нельзя — иначе непонятно, почему у одного сайта выдача под машину, а у
	// другого весь каталог.
	const blind = car ? providers.filter(p => !refOf(p.id)).map(p => p.id) : []
	if (blind.length) ctx.warn(dim(`без машины ищут: ${blind.join(", ")} — нет привязки, ${TOOL} garage import <provider>`))

	const f = await fanout(
		providers,
		// Страницу и размер отдаём сайтам: листает каждый у себя, склейка
		// второй раз по страницам не режет — только по --limit, иначе строка
		// исчезала бы из выдачи дважды и незаметно.
		// id — чтобы наши собственные отказы называли провайдера, а не `bun`.
		p => {
			const ref = refOf(p.id)
			return invoke(
				p.bin,
				["search", query, "--page", String(page), "--limit", String(limit), ...(ref ? ["--car", JSON.stringify(ref)] : [])],
				{ id: p.id },
			)
		},
		parseProducts,
		ctx.warn,
	)
	// Сначала то, что есть у большего числа сайтов: такой товар легче купить.
	const merged = mergeProducts(f.got.map(g => ({ provider: g.provider, items: g.value })))
	const items = merged.slice(0, limit)
	const code = report(f, [], ctx.warn)

	return {
		json: {
			query,
			car: car && used.length ? { id: car.id, name: carLabel(car), providers: used } : null,
			items, total: merged.length, errors: f.failures,
		},
		code,
		render: () => [
			// Заголовок только тогда, когда машина и правда доехала до сайтов:
			// иначе он обещал бы подбор, которого не было.
			...(car && used.length ? [`${dim("машина:")} ${carLabel(car)} ${dim(`· ${used.join(", ")} · искать без машины: --no-car`)}`, ""] : []),
			renderProducts(items, [numCol(items), whereCol<MergedProduct>()]),
			...cut(items.length, merged.length),
			...linkList(items),
			// Подсказки идут одним блоком: пустая строка между ними разносит
			// короткий совет на пол-экрана. Подсказка про `part` под пустой
			// выдачей — совет в никуда: там нет строки, по которой спрашивать.
			...tips([
				...(items.length ? [`${TOOL} part <артикул> <бренд> — цены, сроки и наличие по строке`] : []),
				...(!car && ctx.flags["no-car"] !== true ? [`${TOOL} garage import <provider> — и поиск будет учитывать машину`] : []),
			]),
		].join("\n"),
	}
}

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
import { mergeProducts, siteTotal, type MergedProduct } from "../core/merge.ts"
import { fanout, report } from "../core/partial.ts"
import { cut, extraLinks, tips, whereCol } from "../core/render.ts"
import { parseProducts } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

/**
 * Идентификатор модификации TecDoc из привязки к другому сайту. autodoc зовёт
 * его `modificationId`, armtek — `linkingTargetId`, и это одно и то же число:
 * оба сайта сидят на TecDoc. Поэтому машина, импортированная с одного сайта,
 * годится и другому — он получит ref из одного этого числа и найдёт под ту же
 * модификацию. `carId` сюда не годится: у autodoc это номер машины в его
 * собственном гараже, к TecDoc отношения не имеющий.
 */
function tecdoc(refs: Record<string, Record<string, unknown>> | undefined): { id: number; from: string } | undefined {
	for (const [from, ref] of Object.entries(refs ?? {})) {
		const v = ref.linkingTargetId ?? ref.modificationId
		if (typeof v === "number" && v > 0) return { id: v, from }
	}
	return undefined
}

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
	// Своей привязки у сайта может не быть, а машина всё равно та же: номер
	// модификации TecDoc из чужой привязки понимают оба сайта.
	const shared = car ? tecdoc(car.refs) : undefined
	const refOf = (id: string): Record<string, unknown> | undefined =>
		car?.refs?.[id] ?? (shared && shared.from !== id ? { linkingTargetId: shared.id } : undefined)
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
	// Про машину говорим только за тех, кто ответил: у упавшего сайта уже есть
	// своя строка отказа, и «искал под машину» рядом с ней — неправда.
	const answered = f.got.map(g => g.provider)
	const used = answered.filter(id => refOf(id))
	// Кто ищет по чужой привязке — говорим прямо: выдача у него собрана не по
	// его собственному идентификатору машины.
	const borrowed = shared ? used.filter(id => !car?.refs?.[id]) : []
	// Машина в гараже есть, а на этом сайте её нет: он ищет без неё. Молчать
	// нельзя — иначе непонятно, почему у одного сайта выдача под машину, а у
	// другого весь каталог.
	const blind = car ? answered.filter(id => !refOf(id)) : []
	if (blind.length) ctx.warn(dim(`без машины ищут: ${blind.join(", ")} — нет привязки, ${TOOL} garage import <provider>`))

	// Сначала то, что есть у большего числа сайтов: такой товар легче купить.
	const merged = mergeProducts(f.got.map(g => ({ provider: g.provider, items: g.value.items })))
	const items = merged.slice(0, limit)
	// Сколько нашлось на самих сайтах — если это сказали все, кто ответил.
	const site = siteTotal(f.got.map(g => g.value))
	// Сайт ответил, но ничего не нашёл — это не отказ и в errors ему не место.
	// Промолчать всё же нельзя: в колонке ГДЕ его просто нет, и человек решает,
	// что сайт не спрашивали. Под пустой выдачей строка не нужна — там и так
	// написано, что не нашлось ничего.
	const silent = f.got.filter(g => !g.value.items.length).map(g => g.provider)
	if (silent.length && merged.length) ctx.warn(dim(`ничего не нашли: ${silent.join(", ")}`))
	const code = report(f, [], ctx.warn)

	return {
		json: {
			query,
			car: car && used.length
				? { id: car.id, name: carLabel(car), providers: used, ...(borrowed.length && shared ? { borrowed, from: shared.from } : {}) }
				: null,
			items, total: merged.length, errors: f.failures,
		},
		code,
		render: () => [
			// Заголовок только тогда, когда машина и правда доехала до сайтов:
			// иначе он обещал бы подбор, которого не было.
			// Заголовок держим коротким: имя машины у иных модификаций само по
			// себе в полстроки, и совет про --no-car уезжает вниз, к остальным.
			...(car && used.length
				? [`${dim("машина:")} ${carLabel(car)} ${dim(`· ${used.map(id => (borrowed.includes(id) ? `${id} (через ${shared!.from})` : id)).join(", ")}`)}`, ""]
				: []),
			renderProducts(items, [whereCol<MergedProduct>()]),
			// «Показано X из Y» — подпись к таблице и её списку адресов, поэтому
			// стоит вплотную к ним; блок с адресами вторых сайтов идёт после,
			// отделённый пустой строкой.
			...cut(items.length, merged.length, site),
			...extraLinks(items),
			// Подсказки идут одним блоком: пустая строка между ними разносит
			// короткий совет на пол-экрана. Подсказка про `part` под пустой
			// выдачей — совет в никуда: там нет строки, по которой спрашивать.
			...tips([
				...(items.length ? [`${TOOL} part <артикул> <бренд> — цены, сроки и наличие по строке`] : []),
				...(car && used.length ? ["--no-car — искать без машины, --car <id> — под другую машину гаража"] : []),
				...(!car && ctx.flags["no-car"] !== true ? [`${TOOL} garage import <provider> — и поиск будет учитывать машину`] : []),
			]),
		].join("\n"),
	}
}

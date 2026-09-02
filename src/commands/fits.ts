// fits.ts — «подойдёт ли эта деталь моей машине». Вопрос, ради которого
// половину артикулов и ищут, а сайты отвечают на него по-разному и не всегда.
//
// Машина берётся из локального гаража, а сайту уходит только его собственный
// идентификатор этой машины — как в search. Ответов три: подходит, не
// подходит и «сайт не знает»; последний честнее выдуманного «нет».

import { ProviderError, TOOL, dim, need, renderFits } from "../sdk/index.ts"
import { brandOf } from "../core/args.ts"
import { resolveBrand } from "../core/brand.ts"
import { carLabel, type GarageCar } from "../core/garage.ts"
import { invoke } from "../core/invoke.ts"
import { allFailed, fanout, report } from "../core/partial.ts"
import { chooseCar, refsOf } from "../core/car.ts"
import { tips } from "../core/render.ts"
import { parseFits } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdFits(ctx: Ctx): Promise<Output> {
	const article = need(ctx.args[0], "артикул")
	const wanted = brandOf(ctx)
	const all = await ctx.pick()
	// Сайт без применимости не спрашивается вовсе, но промолчать о нём нельзя:
	// иначе «подходит по всем сайтам» оказалось бы ответом половины.
	const providers = await ctx.pick("fits")
	const skipped = all.filter(p => !providers.some(x => x.id === p.id))
	if (skipped.length) ctx.warn(dim(`применимость не умеют, не спрашиваем: ${skipped.map(p => p.id).join(", ")}`))

	const car: GarageCar | null = await chooseCar(ctx)
	if (!car) throw new ProviderError("bad_args", `нужна машина: ${TOOL} garage add … или ${TOOL} garage import <provider>`)
	const refOf = refsOf(car)

	// Бренд определяется один раз на все сайты — как у part: применимость
	// спрашивают про конкретного производителя, а не про номер вообще.
	// Бросает Ambiguous — её ловит и рисует app.ts.
	const resolved = await resolveBrand(providers, article, wanted, ctx.warn)
	const { brand, failures } = resolved
	if (!brand) {
		return {
			json: { article, brand: null, car: { id: car.id, name: carLabel(car) }, providers: {}, errors: failures },
			code: 0,
			render: () => `по ${article} ничего не нашлось`,
		}
	}

	const holders = providers.filter(p => brand.providers.includes(p.id) && refOf(p.id))
	// У сайта нет привязки этой машины — он и не ответит про применимость.
	const blind = providers.filter(p => brand.providers.includes(p.id) && !refOf(p.id))
	if (blind.length) {
		ctx.warn(dim(`нет привязки машины: ${blind.map(p => p.id).join(", ")} — ${TOOL} garage import <provider>`))
	}

	const f = await fanout(
		holders,
		// id — чтобы наши собственные отказы называли провайдера, а не `bun`.
		p => invoke(p.bin, ["fits", article, "--brand", brand.spelling[p.id]!, "--car", JSON.stringify(refOf(p.id))], { id: p.id }),
		parseFits,
		ctx.warn,
	)
	const code = report(f, failures, ctx.warn)

	return {
		json: {
			article, brand: brand.brand,
			car: { id: car.id, name: carLabel(car), providers: f.got.map(g => g.provider) },
			providers: Object.fromEntries(f.got.map(g => [g.provider, g.value])),
			errors: [...failures, ...f.failures],
		},
		code,
		render: () => [
			`${dim("машина:")} ${carLabel(car)}`,
			"",
			...(f.got.length
				? f.got.map(g => renderFits(g.value, g.provider))
				: [allFailed(f) ? "ни один сайт не ответил" : "применимость спросить не у кого"]),
			// «Не знает» — не тупик: у сайта есть страница детали, где применимость
			// видно глазами, и подбор по машине через search.
			...tips(f.got.some(g => g.value.fits === null)
				? [`${TOOL} search "<название детали>" — подбор по машине, если сайт не знает применимости`]
				: []),
		].join("\n"),
	}
}

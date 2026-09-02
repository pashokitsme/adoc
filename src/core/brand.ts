// brand.ts — общий для part и reviews шаг «артикул → бренд». Правило жёсткое:
// пока производитель не назван однозначно, дальше идти нельзя — цена, срок и
// отзывы у разных производителей одного артикула разные. Здесь же общий ответ
// «ничего не нашлось»: обе команды должны считать код возврата одинаково.

import { brandKey, cyan } from "../sdk/index.ts"
import type { BrandHit } from "../sdk/index.ts"
import type { Output } from "./ctx.ts"
import { Ambiguous } from "./errors.ts"
import { invoke } from "./invoke.ts"
import { mergeBrands, type MergedBrand } from "./merge.ts"
import { allFailed, failureLine, fanout, type Failure, type Fanout } from "./partial.ts"
import type { Provider } from "./registry.ts"
import { parseBrands } from "./validate.ts"

export type Resolved = {
	/** null — ни у кого ничего не нашлось; это пустой результат, а не ошибка. */
	brand: MergedBrand | null
	all: MergedBrand[]
	failures: Failure[]
	/** Шаг брендов целиком: из него берётся код возврата пустой выдачи. */
	step: Fanout<BrandHit[]>
}

export async function resolveBrand(
	providers: Provider[], article: string, wanted: string | undefined, warn: (line: string) => void,
): Promise<Resolved> {
	// id — чтобы наши собственные отказы называли провайдера, а не `bun`.
	const step = await fanout(providers, p => invoke(p.bin, ["brands", article], { id: p.id }), parseBrands, warn)
	const all = mergeBrands(article, step.got.map(g => ({ provider: g.provider, items: g.value })))
	const base = { all, failures: step.failures, step }

	if (!all.length) return { brand: null, ...base }
	if (wanted) {
		const want = brandKey(wanted)
		const hit = all.find(b => b.key === want)
		// Названного бренда нет — показываем те, что есть: человек ошибается в
		// написании чаще, чем сайт теряет производителя.
		if (!hit) throw new Ambiguous(all, step.failures, wanted)
		return { brand: hit, ...base }
	}
	// Отказы уезжают вместе с вопросом: иначе «выбери из двух» промолчало бы о
	// том, что третий сайт не ответил и вариантов на деле могло быть больше.
	if (all.length > 1) throw new Ambiguous(all, step.failures)
	return { brand: all[0]!, ...base }
}

/**
 * Ни у кого ничего не нашлось. Пустой результат — не ошибка; ошибка — только
 * когда не ответил никто, и решает это `allFailed`, а не пересчёт в команде.
 * `rest` — остаток формы `--json`, у part и reviews он разный.
 */
export function emptyResult(article: string, r: Resolved, rest: Record<string, unknown>, warn: (line: string) => void): Output {
	for (const f of r.failures) warn(failureLine(f))
	return {
		json: { article, brand: null, ...rest, errors: r.failures },
		render: () => `по ${cyan(article)} ничего не нашлось`,
		code: allFailed(r.step) ? 1 : 0,
	}
}

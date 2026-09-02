// errors.ts — «уточни бренд». Это не поломка, а вопрос: в теле — из чего
// выбирать. Отдельный класс нужен, чтобы app.ts нарисовал таблицу с колонкой
// «где», которой в контрактном BrandHit нет.
//
// Случая два, и путать их нельзя. Бренд не назвали, а производителей несколько
// — это вопрос к человеку: ambiguous, exit 2. Бренд назвали, но такого нет —
// это уже промах: notfound, exit 1, и в сообщении список тех, что есть, потому
// что ошибаются в написании чаще, чем сайт теряет производителя.
//
// Отказы шага брендов едут вместе с вопросом: список вариантов, собранный
// из половины сайтов, — неполный список, и человек обязан это видеть.

import { ProviderError } from "../sdk/index.ts"
import type { MergedBrand } from "./merge.ts"
import type { Failure } from "./partial.ts"

const listing = (brands: MergedBrand[]): string => brands.map(b => b.brand).join(", ")

export class Ambiguous extends ProviderError {
	constructor(readonly brands: MergedBrand[], readonly failures: Failure[] = [], readonly wanted?: string) {
		super(
			wanted ? "notfound" : "ambiguous",
			wanted
				? `бренд «${wanted}» не найден среди: ${listing(brands)}`
				: "уточни бренд: артикул выпускает несколько производителей — выбери --brand",
			brands.map(b => ({
				brand: b.brand, article: b.article,
				...(b.name ? { name: b.name } : {}), ...(b.rating ? { rating: b.rating } : {}),
				extra: { providers: b.providers },
			})),
		)
	}
}

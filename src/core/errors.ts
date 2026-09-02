// errors.ts — «уточни бренд». Это не поломка, а вопрос: exit 2, а в теле —
// из чего выбирать. Отдельный класс нужен, чтобы app.ts нарисовал таблицу с
// колонкой «где», которой в контрактном BrandHit нет.

import { ProviderError } from "../sdk/index.ts"
import type { MergedBrand } from "./merge.ts"

export class Ambiguous extends ProviderError {
	constructor(readonly brands: MergedBrand[]) {
		super("ambiguous", "уточни бренд: этот артикул выпускает не один производитель", brands.map(b => ({
			brand: b.brand, article: b.article,
			...(b.name ? { name: b.name } : {}), ...(b.rating ? { rating: b.rating } : {}),
			extra: { providers: b.providers },
		})))
	}
}

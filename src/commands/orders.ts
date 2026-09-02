// orders.ts — заказы со всех сайтов, где они есть. Своей истории у обёртки
// нет и быть не может: заказ живёт на сайте, и его номер, статус и сумма —
// оттуда. Общего итога тут нет нарочно: складывать заказы разных сайтов в
// одно число бессмысленно — у каждого свои сроки и своя история.

import { articleKey, brandKey, dim, renderOrders, type Offer, type OrderItemNow, type OrderWithNow } from "../sdk/index.ts"
import { limitOf } from "../core/args.ts"
import { invoke } from "../core/invoke.ts"
import { allFailed, fanout, report } from "../core/partial.ts"
import { blockTitle, cut } from "../core/render.ts"
import { parseOffers, parseOrders } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"
import type { Provider } from "../core/registry.ts"

/**
 * Выбранное предложение: то, что уедет в позицию заказа и в `--json`. Цена без
 * продавца ничего не стоит — по полю «ОТКУДА» и видно, что 856 ₽ против
 * уплаченных 2489 ₽ — это цена другой строки, а не подешевевшая деталь.
 */
type Chosen = { price: number; seller?: string; name?: string; ref?: Record<string, unknown> }

/**
 * Предложение, с которым и правда можно сравнивать уплаченное.
 *
 * Артикул и бренд сверяются заново, хотя сайт спрашивали именно о них: в выдачу
 * приезжают и аналоги (`analog`), и соседние бренды того же номера, а их цена с
 * уплаченной несравнима вовсе.
 *
 * Продавца позиции заказа предпочли бы всем прочим — та же строка у того же
 * продавца и есть «сегодня то же самое». Но продавца в позиции нет: `OrderItem`
 * контракта — это article, brand, name, qty, price, sum, url, и сайты его в
 * истории заказа не отдают. Поэтому берётся самое дешёвое: это же число сайт
 * показывает как «от» в своей выдаче.
 */
function chooseOffer(offers: Offer[], article: string, brand: string): Chosen | undefined {
	const a = articleKey(article), b = brandKey(brand)
	let best: Offer | undefined
	for (const o of offers) {
		if (articleKey(o.article) !== a || brandKey(o.brand) !== b) continue
		if (!best || o.price < best.price) best = o
	}
	return best && { price: best.price, seller: best.seller, name: best.name, ref: best.ref }
}

/** Выбранное предложение в позицию — и на экран, и в `--json` одним и тем же. */
function applyChosen(it: OrderItemNow, c: Chosen): void {
	it.now = c.price
	if (c.seller !== undefined) it.nowSeller = c.seller
	if (c.name !== undefined) it.nowName = c.name
	if (c.ref !== undefined) it.nowRef = c.ref
}

/**
 * Сегодняшняя цена позиций заказа. Запрос на позицию, поэтому строго по
 * очереди и с памятью: один и тот же артикул в разных заказах спрашивается
 * один раз. Сайт ограничил темп — останавливаемся совсем: остальные позиции
 * получили бы не цену, а капчу, и стоили бы того же ожидания.
 *
 * Что именно выбрано из выдачи — дело `chooseOffer`; сюда возвращается уже одна
 * строка, и она же целиком (цена, продавец, название, ref) уходит в позицию.
 */
async function priceNow(ctx: Ctx, p: Provider, orders: OrderWithNow[]): Promise<void> {
	const seen = new Map<string, Chosen | undefined>()
	for (const o of orders) {
		for (const it of o.items ?? []) {
			const key = `${articleKey(it.article)}|${brandKey(it.brand)}`
			if (seen.has(key)) {
				const known = seen.get(key)
				if (known) applyChosen(it, known)
				continue
			}
			const r = await invoke(p.bin, ["offers", it.article, "--brand", it.brand], { id: p.id })
			if (!r.ok) {
				// Отказ по темпу — не «у этой позиции нет цены», а «дальше не
				// спрашиваем»: остальные позиции получат тот же отказ.
				ctx.warn(dim(`${p.id}: цены «сейчас» дальше не спрашиваем — ${r.error.message}`))
				return
			}
			const chosen = chooseOffer(parseOffers(r.json, p.id).items, it.article, it.brand)
			seen.set(key, chosen)
			if (chosen) applyChosen(it, chosen)
		}
	}
}

export async function cmdOrders(ctx: Ctx): Promise<Output> {
	const all = await ctx.pick()
	const providers = await ctx.pick("orders")
	// Сайт без заказов не спрашивается вовсе, но промолчать о нём нельзя:
	// иначе «заказы всех сайтов» тихо оказались бы заказами половины.
	const skipped = all.filter(p => !providers.some(x => x.id === p.id))
	if (skipped.length) ctx.warn(dim(`без заказов, не спрашиваем: ${skipped.map(p => p.id).join(", ")}`))

	// id — чтобы наши собственные отказы («не ответил за 30000 мс») называли
	// провайдера, а не `bun`, которым он случайно запускается.
	const f = await fanout(providers, p => invoke(p.bin, ["orders"], { id: p.id }), parseOrders, ctx.warn)
	const limit = limitOf(ctx.flags)
	// Режется каждый сайт по отдельности: заказы не склеиваются между сайтами,
	// и общий срез оставил бы один сайт без единой строки.
	const shown = f.got.map(g => ({ provider: g.provider, items: g.value.slice(0, limit), total: g.value.length }))
	const code = report(f, [], ctx.warn)

	// Цены «сейчас» спрашиваются только по просьбе: это запрос на каждую
	// позицию, и молча тратить их время (и терпение сайта) нельзя.
	if (ctx.flags.prices === true) {
		for (const g of shown) {
			const p = providers.find(x => x.id === g.provider)
			if (p) await priceNow(ctx, p, g.items)
		}
	}

	return {
		// В --json уходит то же, что на экран: `now`, `nowSeller` и `nowRef`
		// проставлены в тех же объектах — по ref видно, какую строку выдачи сайт
		// имел в виду, и её же можно положить в корзину.
		json: { providers: Object.fromEntries(f.got.map(g => [g.provider, g.value])), errors: f.failures },
		code,
		render: () => shown.length
			? shown.map(g => [
				`\n${blockTitle(g.provider, g.total ? `· заказов ${g.total}` : "")}`,
				renderOrders(g.items),
				...cut(g.items.length, g.total),
			].join("\n")).join("\n")
			// «Заказов нет» и «никто не ответил» — разные новости: первое про
			// пустую историю, второе про то, что её не удалось спросить.
			: allFailed(f) ? "ни один сайт не ответил" : "заказов нет",
	}
}

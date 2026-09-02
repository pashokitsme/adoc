// orders.ts — заказы со всех сайтов, где они есть. Своей истории у обёртки
// нет и быть не может: заказ живёт на сайте, и его номер, статус и сумма —
// оттуда. Общего итога тут нет нарочно: складывать заказы разных сайтов в
// одно число бессмысленно — у каждого свои сроки и своя история.

import { dim } from "../sdk/index.ts"
import { limitOf } from "../core/args.ts"
import { invoke } from "../core/invoke.ts"
import { allFailed, fanout, report } from "../core/partial.ts"
import { blockTitle, cut, linkList, ordersTable } from "../core/render.ts"
import { parseOrders } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

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

	return {
		json: { providers: Object.fromEntries(f.got.map(g => [g.provider, g.value])), errors: f.failures },
		code,
		render: () => shown.length
			? shown.map(g => [
				`\n${blockTitle(g.provider, g.total ? `· заказов ${g.total}` : "")}`,
				ordersTable(g.items),
				...cut(g.items.length, g.total),
				...linkList(g.items),
			].join("\n")).join("\n")
			// «Заказов нет» и «никто не ответил» — разные новости: первое про
			// пустую историю, второе про то, что её не удалось спросить.
			: allFailed(f) ? "ни один сайт не ответил" : "заказов нет",
	}
}

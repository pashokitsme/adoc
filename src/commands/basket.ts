// basket.ts — мультикорзина. Своей корзины у обёртки нет: каждая позиция
// лежит в корзине своего сайта, обёртка только показывает их вместе и
// пересылает изменения. `ref` для добавления непрозрачен: он пришёл от сайта
// в offers и уходит обратно как есть.

import { ProviderError, TOOL, basketTotal, bold, dim, money, need, parseRef, renderBasket } from "../sdk/index.ts"
import type { BasketL } from "../core/delta.ts"
import { one, qtyOf } from "../core/args.ts"
import { BASKET_RM, BASKET_SET } from "../core/help.ts"
import { invoke, passNoise, type InvokeResult } from "../core/invoke.ts"
import { lineOf } from "../core/lastpart.ts"
import { failureText, fanout, report } from "../core/partial.ts"
import { blockTitle, hint, linkList } from "../core/render.ts"
import { parseBasket } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

/** Корзина одного сайта целиком: заголовок с адресом, таблица и ссылки строк. */
const block = (id: string, b: BasketL): string =>
	[blockTitle(id, "", b.url), renderBasket(b), ...linkList(b.items)].join("\n")

/**
 * itemId — колонка ID в выводе корзины. Позиционным его набирают руками
 * (`basket rm alpha alpha-1`), а флагом — когда id похож на подкоманду или
 * начинается с дефиса: у autodoc он длинный и склеенный.
 */
const itemIdOf = (ctx: Ctx): string =>
	need(ctx.args[2] ?? (typeof ctx.flags.id === "string" ? ctx.flags.id : undefined), "itemId — колонка ID в выводе корзины")

export async function cmdBasket(ctx: Ctx): Promise<Output> {
	const sub = ctx.args[0]
	if (sub === undefined) return await listBaskets(ctx)
	if (sub === "add") return await addToBasket(ctx)
	if (sub === "set") return await setQuantity(ctx)
	if (sub === "rm") return await removeItem(ctx)
	throw new ProviderError("bad_args", `неизвестная подкоманда корзины: ${sub} — бывают add, set, rm`)
}

async function listBaskets(ctx: Ctx): Promise<Output> {
	const all = await ctx.pick()
	const providers = await ctx.pick("basket")
	// Сайт без корзины не спрашивается вовсе, но промолчать о нём нельзя:
	// иначе «корзины всех сайтов» тихо оказались бы корзинами половины.
	const skipped = all.filter(p => !providers.some(x => x.id === p.id))
	if (skipped.length) ctx.warn(dim(`без корзины, не спрашиваем: ${skipped.map(p => p.id).join(", ")}`))
	// id — чтобы наши собственные отказы («не ответил за 30000 мс») называли
	// провайдера, а не `bun`, которым он случайно запускается.
	const f = await fanout(providers, p => invoke(p.bin, ["basket"], { id: p.id }), parseBasket, ctx.warn)
	// Валюта у контракта одна на всех (RUB), поэтому суммы сайтов складываются
	// как есть: разнести их по валютам будет нечего, пока валюта не появится.
	const total = f.got.reduce((s, g) => s + basketTotal(g.value), 0)
	const code = report(f, [], ctx.warn)
	return {
		json: { providers: Object.fromEntries(f.got.map(g => [g.provider, g.value])), total, errors: f.failures },
		code,
		render: () => [
			...f.got.map(g => block(g.provider, g.value)),
			`${dim("всего по всем сайтам")}  ${bold(money(total))}`,
			// Формы команд — из таблицы справки: подсказка под таблицей и `--help`
			// расходиться не должны.
			hint(`${TOOL} ${BASKET_SET} · ${TOOL} ${BASKET_RM}`),
		].join("\n\n"),
	}
}

async function addToBasket(ctx: Ctx): Promise<Output> {
	const target = ctx.args[1]
	let providerId: string
	let ref: Record<string, unknown>

	if (target !== undefined && /^[0-9]+$/.test(target)) {
		// Короткая форма: номер строки из последней выдачи part.
		const line = await lineOf(Number(target))
		providerId = line.provider
		ref = line.ref! // lineOf не отдаёт строку без ref
	} else {
		providerId = need(target, `номер строки из ${TOOL} part или имя провайдера`)
		ref = parseRef(ctx.flags.ref)
	}

	const p = await one(ctx, providerId, "basket")
	const r = await invoke(p.bin, ["basket", "add", "--ref", JSON.stringify(ref), "--qty", String(qtyOf(ctx.flags))], { id: p.id })
	return afterChange(ctx, p.id, r)
}

async function setQuantity(ctx: Ctx): Promise<Output> {
	const p = await one(ctx, ctx.args[1], "basket")
	const itemId = itemIdOf(ctx)
	if (ctx.flags.qty === undefined) throw new ProviderError("bad_args", "нужен --qty <n>")
	const r = await invoke(p.bin, ["basket", "set", itemId, "--qty", String(qtyOf(ctx.flags))], { id: p.id })
	return afterChange(ctx, p.id, r)
}

async function removeItem(ctx: Ctx): Promise<Output> {
	const p = await one(ctx, ctx.args[1], "basket")
	const itemId = itemIdOf(ctx)
	const r = await invoke(p.bin, ["basket", "rm", itemId], { id: p.id })
	return afterChange(ctx, p.id, r)
}

/**
 * Контракт требует, чтобы add/set/rm возвращали корзину целиком, — поэтому
 * второго вызова после изменения не нужно, печатаем то, что пришло.
 */
function afterChange(ctx: Ctx, id: string, r: InvokeResult): Output {
	passNoise(id, r, ctx.warn)
	// Подпись та же, что у жёлтых строк списка: имя виноватого один раз и
	// подсказка про вход, если сайт просит логин.
	if (!r.ok) throw new ProviderError(r.error.code, failureText({ provider: id, code: r.error.code, message: r.error.message }))
	const basket: BasketL = parseBasket(r.json, id)
	return { json: { provider: id, basket }, render: () => block(id, basket) }
}

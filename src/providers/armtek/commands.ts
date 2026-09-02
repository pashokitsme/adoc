// commands.ts — команды armtek сверх контракта: карточка товара, точки выдачи
// и сырой вызов для эндпоинтов, до которых у контракта нет команды.

import { ProviderError, articleKey, brandKey, render } from "../../sdk/index.ts"
import type { ProviderCommand } from "../../sdk/define.ts"
import * as api from "./api.ts"
import type { RawCard } from "./api.ts"
import { readToken, type Account } from "./auth.ts"
import { deliveryDays, num, productUrl, quantity } from "./map.ts"

const { bar, bold, cyan, days, dim, green, heading, money, stars, table, yellow } = render

type Cmd = ProviderCommand<Account>

const need = (v: string | undefined, what: string): string => {
	if (!v) throw new ProviderError("bad_args", `нужен ${what}`)
	return v
}

const place = (a: Account | null) => ({ vkorg: a?.vkorg ?? api.DEFAULT_VKORG, vstel: a?.vstel ?? api.DEFAULT_VSTEL })

/** Хвост вида `k=v` — параметры запроса для сырого вызова. */
const kv = (rest: string[]): Record<string, string> =>
	Object.fromEntries(rest.filter(a => a.includes("=")).map(a => { const i = a.indexOf("="); return [a.slice(0, i), a.slice(i + 1)] }))

const qtyCell = (rvalue: string | undefined): string => {
	const q = quantity(rvalue)
	if (q.value === undefined) return dim("нет")
	return green(`${q.atLeast ? ">" : ""}${q.value} шт`)
}

/**
 * Карточка товара формой `card`: там предложение слито с артикулом, поэтому
 * одну деталь видно целиком — все склады, цены и сроки одной таблицей.
 */
const info: Cmd = {
	usage: "info <артикул> --brand <имя>", about: "карточка: цены по складам, сроки, оценки", auth: false,
	run: async (ctx, args) => {
		const article = need(args[0], "артикул")
		const brand = typeof ctx.flags.brand === "string" && ctx.flags.brand ? ctx.flags.brand : undefined
		const token = await readToken(ctx)
		const r = await api.search({ query: article, queryType: 2, typeView: "card", ...place(ctx.account) }, token)
		const wantArticle = articleKey(article)
		const rows = (r.articlesData ?? []).filter((c: RawCard) =>
			articleKey(c.PIN) === wantArticle && (!brand || brandKey(c.BRAND) === brandKey(brand)))
		if (!rows.length) throw new ProviderError("notfound", `armtek: ${article}${brand ? ` (${brand})` : ""} — ничего не найдено`)

		const head = rows[0]!
		const stats = await api.reviewRating(head.ARTID, token).catch(() => [])
		const s = stats[0]
		return {
			json: { article: head.PIN, brand: head.BRAND, artId: head.ARTID, url: productUrl(head.ARTICLE_ALIAS), rating: s ?? null, offers: rows },
			render: () => [
				// в форме card NAME — это название предложения, человеческое лежит в CUSTOM_NAME
				`${bold(head.CUSTOM_NAME || head.NAME || head.PIN)}  ${dim(head.PIN)}`,
				`${head.BRAND}  ${dim(`artId ${head.ARTID}`)}`,
				heading("Оценки"),
				`  ${stars(num(s?.rating))}  ${bold(s?.rating ?? "—")}  ${dim(`${s?.reviewCount ?? 0} отзывов`)}`,
				...bar(s ? [s.fiveStarsCount, s.fourStarsCount, s.threeStarsCount, s.twoStarsCount, s.oneStarsCount] : undefined),
				heading("Предложения"),
				table(rows.map(c => [
					bold(c.BRAND), money(num(c.PRICES1)), qtyCell(c.RVALUE),
					days(deliveryDays(c.DLVDT)), dim(c.KEYZAK ?? "—"), c.TYPE === "CHEAP" ? green("дешевле") : c.TYPE === "FAST" ? yellow("быстрее") : "",
				]), ["БРЕНД", "ЦЕНА", "НАЛИЧИЕ", "СРОК", "СКЛАД", ""]),
				dim(`\n${productUrl(head.ARTICLE_ALIAS) ?? ""}`),
			].join("\n"),
		}
	},
}

/** Точки выдачи: от выбранной зависят цена, срок и наличие в поиске. */
const vstel: Cmd = {
	usage: "vstel [поиск]", about: "точки выдачи; текущая помечена ★", auth: false,
	run: async (ctx, args) => {
		const r = await api.vstelList(await readToken(ctx), args.join(" "))
		const cur = place(ctx.account).vstel
		return {
			json: r,
			render: () => {
				if (!r.items?.length) return "точек не нашлось"
				return table(r.items.map(v => [
					v.vstel === cur ? yellow("★") : " ", cyan(v.vstel), bold(v.vname ?? ""),
					dim(String(v.vkorg ?? "")), (v.adress ?? "").slice(0, 52), dim(v.typobj ?? ""),
				]), [" ", "КОД", "НАЗВАНИЕ", "VKORG", "АДРЕС", "ТИП"]) +
					dim(`\n\nвсего ${r.paginator?.totalCount ?? r.items.length}; ★ — точка аккаунта`)
			},
		}
	},
}

/**
 * Сырой вызов. Карта в docs/armtek-api.md описывает 294 эндпоинта, команд у
 * контракта на них нет — эта затычка даёт дотянуться без curl и без ручной
 * возни с четырьмя заголовками и токеном.
 */
const raw: Cmd = {
	usage: "raw <METHOD> <путь> [k=v ...] [--body <json>]", about: "произвольный вызов rest/ru c токеном и заголовками", auth: false,
	run: async (ctx, args) => {
		const method = need(args[0], "метод: GET, POST, PUT или DELETE").toUpperCase()
		const path = need(args[1], "путь после rest/ru/")
		const query = new URLSearchParams(kv(args.slice(2))).toString()
		let body: unknown
		if (typeof ctx.flags.body === "string" && ctx.flags.body) {
			try { body = JSON.parse(ctx.flags.body) } catch { throw new ProviderError("bad_args", "--body должен быть JSON") }
		}
		const token = await readToken(ctx)
		const p = query ? `${path}${path.includes("?") ? "&" : "?"}${query}` : path
		return { json: await api.raw(method, p, { token, vkorg: place(ctx.account).vkorg, ...(body === undefined ? {} : { body }) }) }
	},
}

export const commands: Record<string, Cmd> = { info, vstel, raw }

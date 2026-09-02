// commands.ts — команды armtek сверх контракта: точки выдачи и сырой вызов для
// эндпоинтов, до которых у контракта команды нет. Карточка товара переехала в
// контрактную `info`.

import { ProviderError, render } from "../../sdk/index.ts"
import type { ProviderCommand } from "../../sdk/define.ts"
import * as api from "./api.ts"
import { publicRead, readToken, type Account } from "./auth.ts"

const { bold, cyan, dim, table, yellow } = render

type Cmd = ProviderCommand<Account>

const need = (v: string | undefined, what: string): string => {
	if (!v) throw new ProviderError("bad_args", `нужен ${what}`)
	return v
}

const place = (a: Account | null) => ({ vkorg: a?.vkorg ?? api.DEFAULT_VKORG, vstel: a?.vstel ?? api.DEFAULT_VSTEL })

/** Хвост вида `k=v` — параметры запроса для сырого вызова. */
const kv = (rest: string[]): Record<string, string> =>
	Object.fromEntries(rest.filter(a => a.includes("=")).map(a => { const i = a.indexOf("="); return [a.slice(0, i), a.slice(i + 1)] }))

/** Точки выдачи: от выбранной зависят цена, срок и наличие в поиске. */
const vstel: Cmd = {
	usage: "vstel [поиск]", about: "точки выдачи; текущая помечена ★", auth: false,
	run: async (ctx, args) => {
		const r = await publicRead(ctx, token => api.vstelList(token, args.join(" ")))
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
	usage: "raw <METHOD> <путь> [k=v ...] [--body <json>]", about: "произвольный вызов rest/ru: идёт с токеном аккаунта и любым методом, то есть умеет и писать", auth: true,
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

export const commands: Record<string, Cmd> = { vstel, raw }

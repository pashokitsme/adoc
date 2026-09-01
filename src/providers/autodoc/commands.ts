// commands.ts — команды autodoc сверх контракта. Всё, что раньше было в
// src/main.ts, кроме контрактных операций.

import type { ProviderCommand } from "../../sdk/define.ts"
import { ProviderError } from "../../sdk/errors.ts"
import { bar, bold, cyan, days, dim, green, heading, money, stars, table, yellow } from "../../sdk/render.ts"
import * as api from "./api.ts"
import type { Tokens } from "./auth.ts"
import { resolveBrand } from "./brand.ts"

type Cmd = ProviderCommand<Tokens>

const need = (v: string | undefined, what: string): string => {
	if (!v) throw new ProviderError("bad_args", `нужен ${what}`)
	return v
}

const numArg = (v: string | undefined, what: string): number => {
	const n = Number(need(v, what))
	if (!Number.isFinite(n)) throw new ProviderError("bad_args", `${what} должен быть числом, а не «${v}»`)
	return n
}

/** Хвост вида `k=v` — параметры запроса для произвольных get/post. */
const kv = (rest: string[]): Record<string, string> =>
	Object.fromEntries(rest.filter(a => a.includes("=")).map(a => { const i = a.indexOf("="); return [a.slice(0, i), a.slice(i + 1)] }))

/**
 * Числовой флаг провайдера. Проверка та же, что у контрактных --page/--limit в
 * run.ts: без неё NaN уехал бы в параметры запроса и вернулся бы невнятной
 * ошибкой сервера вместо честного bad_args.
 */
const numFlag = (name: string, v: string | true | undefined): number | undefined => {
	if (v === undefined) return undefined
	if (v === true || v === "") throw new ProviderError("bad_args", `--${name}: нужно значение`)
	const n = Number(v)
	if (!Number.isInteger(n) || n < 0) throw new ProviderError("bad_args", `--${name}: нужно неотрицательное целое число, а не «${v}»`)
	return n
}

/** brandId позиционно или --brand по имени. */
const brandArg = (args: string[], flags: Record<string, string | true>): string | undefined =>
	typeof flags.brand === "string" ? flags.brand : args[1]

const goods: Cmd = {
	usage: "goods <categoryId> [--page <n>] [--sort <id>] [--limit <n>]", about: "товары внутри категории (id даёт search)", auth: false,
	run: async (ctx, args) => {
		const r = await api.categoryGoods(numArg(args[0], "categoryId"), { PageNumber: ctx.page, SortingId: numFlag("sort", ctx.flags.sort) })
		return { json: r, render: () => {
			const head = dim(`всего ${r.totalCount}, страница ${ctx.page}`)
			if (!r.items?.length) return head
			return head + "\n" + table(r.items.slice(0, ctx.limit).map(g => [
				cyan(g.article), bold(g.name.slice(0, 46)), dim(g.manufacturer?.name ?? ""), money(g.price),
				g.quantity ? green(`${g.quantity} шт`) : dim("нет"), g.rating?.quantity ? `${g.rating.average.toFixed(1)}★` : dim("—"),
			]), ["АРТИКУЛ", "НАЗВАНИЕ", "ПРОИЗВОДИТЕЛЬ", "ЦЕНА", "НАЛИЧИЕ", "РЕЙТИНГ"]) +
				(r.sorting?.length ? dim(`\n--sort: ${r.sorting.map(s => `${s.id}=${s.name}`).join(", ")}`) : "")
		} }
	},
}

const info: Cmd = {
	usage: "info <артикул> [brandId | --brand <имя>]", about: "карточка: рейтинг, гистограмма, наличие", auth: false,
	run: async (ctx, args) => {
		const article = need(args[0], "артикул")
		const b = await resolveBrand(article, brandArg(args, ctx.flags))
		const [inf, price] = await Promise.all([api.goodsInfo(article, b.id), api.goodsPrice(article, b.id).catch(() => null)])
		return { json: { info: inf, price }, render: () => [
			`${bold(inf.name)}  ${dim(inf.article)}`, `${inf.manufacturer.name}  ${dim(`id ${inf.manufacturer.id}`)}`,
			heading("Оценки"), `  ${stars(inf.rating?.average)}  ${bold(inf.rating?.average?.toFixed(2) ?? "—")}  ${dim(`${inf.rating?.quantity ?? 0} оценок`)}`,
			...bar(inf.rating?.ratings),
			heading("Наличие и цена"), `  минимальная цена  ${bold(money(price?.minimalPrice))}`, `  срок              ${days(price?.minimalDeliveryDays)}`,
			`  на складе         ${inf.inStock ? green(`${inf.inStock} шт`) : dim("нет")}`,
			...(inf.categoryId ? [`  категория         ${cyan(String(inf.categoryId))}`] : []),
			dim(`\nhttps://www.autodoc.ru/price/${inf.manufacturer.id}/${inf.article}`),
		].join("\n") }
	},
}

// Сырой ответ как есть: у originals и analogs полей больше, чем помещается в
// контрактный Offer, а через эти команды до них можно дотянуться без jq по сети.
const rawByBrand = (usage: string, about: string, fn: (a: string, id: number) => Promise<unknown>): Cmd => ({
	usage, about, auth: true,
	run: async (ctx, args) => {
		const article = need(args[0], "артикул")
		const b = await resolveBrand(article, brandArg(args, ctx.flags))
		return { json: await fn(article, b.id) }
	},
})

const garage: Cmd = {
	usage: "garage [parts <carId> | main <carId>]", about: "гараж сайта: список, подборка под машину, основная", auth: true,
	run: async (_ctx, args) => {
		const [sub, arg] = args
		if (sub === "main") {
			const id = numArg(arg, "id машины: `garage main <carId>`")
			await api.garageSetMain(id)
			return { json: { ok: true, mainCarId: id }, render: () => green(`основной автомобиль теперь ${id}`) }
		}
		if (sub === "parts") {
			const r = await api.garageProducts(numArg(arg, "id машины: `garage parts <carId>`"))
			return { json: r, render: () => {
				const goodsList = r.goods ?? []
				if (!goodsList.length) return dim("подборки для этой машины нет")
				return (r.modification ? dim(r.modification) + "\n" : "") + table(goodsList.map(g => {
					const best = (g.items ?? []).reduce<{ price?: number; deliveryDays?: number } | null>(
						(acc, it) => (acc === null || (it.price ?? Infinity) < (acc.price ?? Infinity) ? it : acc), null)
					return [cyan(g.article), bold(g.name.slice(0, 40)), dim(g.manufacturer?.name ?? ""), money(best?.price), days(best?.deliveryDays), dim(g.groupName ?? "")]
				}), ["АРТИКУЛ", "НАЗВАНИЕ", "ПРОИЗВОДИТЕЛЬ", "ОТ", "СРОК", "ГРУППА"])
			} }
		}
		if (sub) throw new ProviderError("bad_args", `неизвестная подкоманда гаража: ${sub}`)
		const [list, top] = await Promise.all([api.garageCars(), api.garageTopCar().catch(() => null)])
		const mainId = top?.car?.id ?? null
		return { json: { ...list, mainCarId: mainId }, render: () => {
			const cars = list.cars ?? []
			if (!cars.length) return dim("гараж пуст")
			return table(cars.map(c => [c.id === mainId ? yellow("★") : " ", cyan(String(c.id)), bold([c.brand, c.model].filter(Boolean).join(" ")),
				c.engine ?? dim("—"), c.year ? String(c.year) : dim("—"), c.vin ?? dim("—"), c.odometer ? `${c.odometer.toLocaleString("ru-RU")} км` : dim("—")]),
				[" ", "ID", "АВТОМОБИЛЬ", "ДВИГАТЕЛЬ", "ГОД", "VIN", "ПРОБЕГ"]) + dim("\n\n★ — основная; `garage parts <id>` — подборка под неё")
		} }
	},
}

const raw = (method: "GET" | "POST"): Cmd => ({
	usage: `${method.toLowerCase()} <путь> [k=v ...] [--auth]`, about: `произвольный ${method} к web.autodoc.ru`, auth: false,
	run: async (ctx, args) => ({ json: await api.raw(method, need(args[0], "путь"), kv(args.slice(1)), ctx.flags.auth === true) }),
})

export const commands: Record<string, Cmd> = {
	goods, info,
	prices: rawByBrand("prices <артикул> [brandId | --brand <имя>]", "сырые предложения продавцов (originals)", api.offers),
	analogs: rawByBrand("analogs <артикул> [brandId | --brand <имя>]", "сырые аналоги", api.analogs),
	favorites: { usage: "favorites [listId]", about: "избранное; без аргумента — списки", auth: true,
		run: async (_ctx, args) => ({ json: args[0] ? await api.favorites(numArg(args[0], "listId")) : await api.favoriteLists() }) },
	orders: { usage: "orders", about: "заказы", auth: true, run: async () => ({ json: await api.orders() }) },
	profile: { usage: "profile", about: "сводка по аккаунту", auth: true, run: async () => ({ json: await api.profile() }) },
	garage,
	get: raw("GET"), post: raw("POST"),
}

// commands.ts — команды autodoc сверх контракта. Всё, что раньше было в
// src/main.ts, кроме контрактных операций.
//
// Правило вывода то же, что и у контрактных команд: человеку — таблица или
// карточка, `--json` — сырой ответ сайта как есть, без переработки.

import { ProviderError, positiveInt, render, type ProviderCommand } from "../../sdk/index.ts"
import * as api from "./api.ts"
import type { Tokens } from "./auth.ts"
import { resolveBrand } from "./brand.ts"
import { cardUrl, toOffers } from "./map.ts"

const { bold, cyan, days, dim, fields, green, money, money: rub, renderOffers, table, urlList, yellow } = render

type Cmd = ProviderCommand<Tokens>

const need = (v: string | undefined, what: string): string => {
	if (!v) throw new ProviderError("bad_args", `нужен ${what}`)
	return v
}

/** Числовой аргумент-идентификатор: у сайта они всегда целые и с единицы. */
const numArg = (v: string | undefined, what: string): number => positiveInt(what, need(v, what))

/** Хвост вида `k=v` — параметры запроса для произвольных get/post. */
const kv = (rest: string[]): Record<string, string> =>
	Object.fromEntries(rest.filter(a => a.includes("=")).map(a => { const i = a.indexOf("="); return [a.slice(0, i), a.slice(i + 1)] }))

/**
 * Числовой флаг провайдера. Проверка та же, что у контрактных --page/--limit в
 * run.ts: без неё NaN уехал бы в параметры запроса и вернулся бы невнятной
 * ошибкой сервера вместо честного bad_args.
 */
const numFlag = (name: string, v: string | true | undefined): number | undefined =>
	v === undefined ? undefined : positiveInt(`--${name}`, v)

/** brandId позиционно или --brand по имени. */
const brandArg = (args: string[], flags: Record<string, string | true>): string | undefined =>
	typeof flags.brand === "string" ? flags.brand : args[1]

const goods: Cmd = {
	usage: "goods <categoryId> [--page <n>] [--sort <id>] [--limit <n>]", about: "товары внутри категории (id даёт search)", auth: false,
	run: async (ctx, args) => {
		// PageNumber у этой ручки нумеруется с нуля, а --page у нас с единицы
		const r = await api.categoryGoods(numArg(args[0], "categoryId"), {
			PageNumber: ctx.page - 1, MaxResultCount: ctx.limit, SortingId: numFlag("sort", ctx.flags.sort),
		})
		return { json: r, render: () => {
			const head = dim(`${r.categoryName ?? ""}${r.categoryName ? " · " : ""}всего ${r.totalCount}, страница ${ctx.page}`)
			if (!r.items?.length) return head
			const rows = r.items.slice(0, ctx.limit)
			return head + "\n" + table(rows.map((g, i) => [
				String(i + 1), cyan(g.article), bold(g.name.slice(0, 46)), dim(g.manufacturer?.name ?? ""), money(g.price),
				g.quantity ? green(`${g.quantity} шт`) : dim("нет"), g.rating?.quantity ? `${g.rating.average.toFixed(1)}★` : dim("—"),
			]), ["#", "АРТИКУЛ", "НАЗВАНИЕ", "ПРОИЗВОДИТЕЛЬ", "ЦЕНА", "НАЛИЧИЕ", "РЕЙТИНГ"]) +
				urlList(rows.map(g => ({ url: g.manufacturer ? cardUrl(g.manufacturer.id, g.article) : undefined }))) +
				(r.sorting?.length ? dim(`\n--sort: ${r.sorting.map(s => `${s.id}=${s.name}`).join(", ")}`) : "")
		} }
	},
}

/**
 * Прайс-лист как его отдаёт сайт: `offers` показывает то же самое, но
 * `--json` тут — сырой `originals` со всеми полями строки прайса, до которых
 * контрактный `Offer` не дотягивается.
 */
const prices: Cmd = {
	usage: "prices <артикул> [brandId | --brand <имя>]", about: "прайс-лист продавцов (сырой originals в --json)", auth: true,
	run: async (ctx, args) => {
		const article = need(args[0], "артикул")
		const b = await resolveBrand(article, brandArg(args, ctx.flags))
		const raw = await api.offers(article, b.id)
		return { json: raw, render: () => renderOffers(toOffers(raw, article, b.name || article)) }
	},
}

const favorites: Cmd = {
	usage: "favorites [listId]", about: "избранное; без аргумента — списки", auth: true,
	run: async (ctx, args) => {
		if (!args[0]) {
			const r = await api.favoriteLists()
			return { json: r, render: () => {
				const items = r.items ?? []
				if (!items.length) return dim("списков избранного нет")
				return table(items.map(l => [cyan(String(l.id)), bold(l.name ?? ""), `${l.goodsCount ?? 0} шт`]),
					["ID", "СПИСОК", "ТОВАРОВ"]) + dim("\n\n`favorites <id>` — что внутри списка")
			} }
		}
		const r = await api.favorites(numArg(args[0], "listId"))
		return { json: r, render: () => {
			const items = r.items ?? []
			if (!items.length) return dim("в списке пусто")
			return table(items.map((g, i) => [
				String(i + 1), cyan(g.article ?? ""), bold(g.manufacturerName ?? ""), (g.goodsName ?? "").slice(0, 44), money(g.price),
			]), ["#", "АРТИКУЛ", "БРЕНД", "НАЗВАНИЕ", "ЦЕНА"]) +
				urlList(items.map(g => ({ url: g.manufacturerId !== undefined && g.article ? cardUrl(g.manufacturerId, g.article) : undefined })))
		} }
	},
}

const profile: Cmd = {
	usage: "profile", about: "сводка по аккаунту: баланс, бонусы, сертификаты", auth: true,
	run: async () => {
		const r = await api.profile()
		return { json: r, render: () => fields([
			["баланс", bold(rub(r.balanceAmount))],
			["бонусы", r.bonusAmount ? green(String(r.bonusAmount)) : dim("нет")],
			["сертификаты", r.certificateCount ? String(r.certificateCount) : dim("нет")],
		]) }
	},
}

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
				return (r.modification ? dim(r.modification) + "\n" : "") + table(goodsList.map((g, i) => {
					const best = (g.items ?? []).reduce<{ price?: number; deliveryDays?: number } | null>(
						(acc, it) => (acc === null || (it.price ?? Infinity) < (acc.price ?? Infinity) ? it : acc), null)
					return [
						String(i + 1), cyan(g.article), bold(g.name.slice(0, 40)), dim(g.manufacturer?.name ?? ""),
						money(best?.price), days(best?.deliveryDays), dim(g.groupName ?? ""),
					]
				}), ["#", "АРТИКУЛ", "НАЗВАНИЕ", "ПРОИЗВОДИТЕЛЬ", "ОТ", "СРОК", "ГРУППА"]) +
					urlList(goodsList.map(g => ({ url: g.manufacturer ? cardUrl(g.manufacturer.id, g.article) : undefined })))
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
	goods, prices, favorites, profile, garage,
	get: raw("GET"), post: raw("POST"),
}

// delta.ts — часть контракта v1, которой пока нет в src/sdk/contract.ts:
// новые команды (info, analogs, orders), capability «orders» и поля `url`
// у брендов, отзывов и позиций корзины. Правки в сам контракт вносит ветка
// провайдеров; до её мержа агрегатор описывает эти формы у себя, чтобы код
// писался под уже согласованные имена и проверялся на фейковых провайдерах.
//
// ПОСЛЕ МЕРЖА feat/providers-v2: файл удаляется, импорты переезжают на
// ../sdk/index.ts, приведение `as Cap` в validate.ts снимается.

import type { Basket, BasketItem, BrandHit, Capability, Rating, Review, Reviews } from "../sdk/index.ts"

/** Capability вместе с «orders», которого ещё нет в контрактном типе. */
export type Cap = Capability | "orders"

/** Все известные обёртке возможности — по ним фильтруется describe. */
export const CAPABILITIES: Cap[] = ["reviews", "garage", "analogs", "basket", "orders"]

/** Карточка артикула этого бренда на сайте (part → «где»). */
export type BrandHitL = BrandHit & { url?: string }

/** Конкретный отзыв, если сайт умеет на него ссылаться. */
export type ReviewL = Review & { url?: string }

/** `url` — страница отзывов на сайте. */
export type ReviewsL = Omit<Reviews, "items"> & { url?: string; items: ReviewL[] }

/** `url` — карточка товара из позиции корзины. */
export type BasketItemL = BasketItem & { url?: string }
export type BasketL = Omit<Basket, "items"> & { items: BasketItemL[] }

/** Склад сайта: код, человеческое имя и остаток, если сайт его показывает. */
export type Stock = { code: string; name?: string; quantity?: number }

/** Ответ команды `info <артикул> --brand <имя>`: карточка одного сайта. */
export type Info = {
	article: string
	brand: string
	name: string
	url?: string
	rating?: Rating & { histogram?: number[] }
	images?: string[]
	price?: number
	currency?: string
	deliveryDays?: number
	stock?: Stock[]
	description?: string
	extra?: Record<string, unknown>
}

export type OrderItem = {
	article: string
	brand: string
	name: string
	qty: number
	price: number
	sum?: number
	url?: string
}

/** Заказ на сайте. `date` — ISO; `status` — как его называет сам сайт. */
export type Order = {
	id: string
	date: string
	status: string
	total: number
	currency: string
	url?: string
	items?: OrderItem[]
	extra?: Record<string, unknown>
}

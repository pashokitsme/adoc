// car.ts — машина гаража для команд, которые спрашивают о ней сайты (search,
// fits). Правило одно на всех: наружу уходит не VIN и не гараж, а только
// собственный ref сайта, который тот сам и отдал в `garage export`.

import { positiveInt } from "../sdk/index.ts"
import type { Ctx } from "./ctx.ts"
import { carById, loadGarage, mainCar, type GarageCar } from "./garage.ts"

/**
 * Идентификатор модификации TecDoc из привязки к другому сайту. autodoc зовёт
 * его `modificationId`, armtek — `linkingTargetId`, и это одно и то же число:
 * оба сайта сидят на TecDoc. Поэтому машина, импортированная с одного сайта,
 * годится и другому — он получит ref из одного этого числа и найдёт под ту же
 * модификацию. `carId` сюда не годится: у autodoc это номер машины в его
 * собственном гараже, к TecDoc отношения не имеющий.
 */
export function tecdoc(refs: Record<string, Record<string, unknown>> | undefined): { id: number; from: string } | undefined {
	for (const [from, ref] of Object.entries(refs ?? {})) {
		const v = ref.linkingTargetId ?? ref.modificationId
		if (typeof v === "number" && v > 0) return { id: v, from }
	}
	return undefined
}

/**
 * Какая машина участвует: по умолчанию основная из гаража — к ней запчасть и
 * ищут чаще всего. `--car <id>` берёт другую машину гаража, `--no-car`
 * выключает подбор совсем.
 */
export async function chooseCar(ctx: Ctx): Promise<GarageCar | null> {
	if (ctx.flags["no-car"] === true) return null
	const g = await loadGarage()
	if (ctx.flags.car === undefined) return mainCar(g) ?? null
	return carById(g, positiveInt("--car", ctx.flags.car))
}

/**
 * Ref машины для сайта: свой, а если своего нет — собранный из чужого номера
 * модификации TecDoc. Сайт без привязки получает `undefined`, и звать его с
 * машиной незачем.
 */
export function refsOf(car: GarageCar | null): (id: string) => Record<string, unknown> | undefined {
	const shared = car ? tecdoc(car.refs) : undefined
	return id => car?.refs?.[id] ?? (shared && shared.from !== id ? { linkingTargetId: shared.id } : undefined)
}

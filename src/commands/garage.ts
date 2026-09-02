// garage.ts — гараж целиком локальный: ни одна из этих подкоманд не ходит в
// сеть. Импорт с сайта — отдельная подкоманда, и её пользователь зовёт сам.

import { ProviderError, TOOL, bold, dim, intFlag, need, positiveInt, renderCars } from "../sdk/index.ts"
import type { Flags } from "../sdk/index.ts"
import { addCar, checkVin, findByVin, loadGarage, removeCar, saveGarage, setMain } from "../core/garage.ts"
import { garageCols, hint } from "../core/render.ts"
import type { Ctx, Output } from "../core/ctx.ts"

/** Строковый флаг: пустая строка и голый `--brand` — не значение. */
const strFlag = (flags: Flags, name: string): string | undefined => {
	const v = flags[name]
	if (v === true) throw new ProviderError("bad_args", `--${name}: нужно значение`)
	return v === "" ? undefined : v
}

export async function cmdGarage(ctx: Ctx): Promise<Output> {
	const sub = ctx.args[0]
	if (sub === undefined) return await showGarage()
	if (sub === "add") return await addToGarage(ctx)
	if (sub === "rm") return await dropFromGarage(ctx)
	if (sub === "main") return await chooseMain(ctx)
	throw new ProviderError("bad_args", `неизвестная подкоманда гаража: ${sub} — бывают add, rm, main, import`)
}

async function showGarage(): Promise<Output> {
	const g = await loadGarage()
	return {
		json: g,
		render: () => [renderCars(g.cars, garageCols(g)), hint(`${TOOL} garage add --brand <марка> --model <модель> · ${TOOL} garage import <provider>`)].join("\n"),
	}
}

async function addToGarage(ctx: Ctx): Promise<Output> {
	const brand = need(strFlag(ctx.flags, "brand"), "--brand <марка>")
	const model = need(strFlag(ctx.flags, "model"), "--model <модель>")
	const raw = strFlag(ctx.flags, "vin")
	const vin = raw === undefined ? undefined : checkVin(raw)
	const g = await loadGarage()
	// Один автомобиль двумя строками — это не гараж, а путаница: дальше по
	// VIN нельзя будет сказать, какую машину человек имел в виду.
	const twin = vin === undefined ? undefined : findByVin(g, vin)
	if (twin) throw new ProviderError("bad_args", `VIN ${vin} уже в гараже — машина ${twin.id} (${twin.brand} ${twin.model})`)
	const { garage, car } = addCar(g, {
		brand, model,
		modification: strFlag(ctx.flags, "modification"),
		year: intFlag("year", ctx.flags.year),
		engine: strFlag(ctx.flags, "engine"),
		vin,
		odometer: intFlag("odometer", ctx.flags.odometer),
	})
	await saveGarage(garage)
	return { json: { ok: true, car }, render: () => `${bold(`${car.brand} ${car.model}`)} добавлена под номером ${car.id}\n${renderCars(garage.cars, garageCols(garage))}` }
}

async function dropFromGarage(ctx: Ctx): Promise<Output> {
	const id = positiveInt("id машины", need(ctx.args[1], "id машины — колонка ID в adoc garage"))
	const garage = removeCar(await loadGarage(), id)
	await saveGarage(garage)
	return { json: { ok: true, removed: id }, render: () => `${dim(`машина ${id} удалена`)}\n${renderCars(garage.cars, garageCols(garage))}` }
}

async function chooseMain(ctx: Ctx): Promise<Output> {
	const id = positiveInt("id машины", need(ctx.args[1], "id машины — колонка ID в adoc garage"))
	const garage = setMain(await loadGarage(), id)
	await saveGarage(garage)
	return { json: { ok: true, mainId: id }, render: () => renderCars(garage.cars, garageCols(garage)) }
}

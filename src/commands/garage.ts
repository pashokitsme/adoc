// garage.ts — гараж целиком локальный: ни одна из этих подкоманд не ходит в
// сеть. Импорт с сайта — отдельная подкоманда, и её пользователь зовёт сам.

import { ProviderError, TOOL, bold, dim, intFlag, need, positiveInt, renderCars } from "../sdk/index.ts"
import type { Flags } from "../sdk/index.ts"
import { one } from "../core/args.ts"
import { addCar, checkVin, findByVin, loadGarage, mergeImported, removeCar, saveGarage, setMain } from "../core/garage.ts"
import { invoke, passNoise } from "../core/invoke.ts"
import { failureText } from "../core/partial.ts"
import { garageCols, hint } from "../core/render.ts"
import { parseCars } from "../core/validate.ts"
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
	if (sub === "import") return await importGarage(ctx)
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

/**
 * Забирает машины сайта в локальный гараж. Обратно не уходит ничего: своя
 * машина может быть заведена там, где её нет, и это дело владельца, а VIN —
 * его личные данные. Сайт спрашивается ровно один, названный аргументом:
 * «импортировать со всех» скрыло бы, чей аккаунт сейчас откроют.
 */
async function importGarage(ctx: Ctx): Promise<Output> {
	const p = await one(ctx, ctx.args[1], "garage")
	// id — чтобы наши собственные отказы («не ответил за 30000 мс») называли
	// провайдера, а не бинарь, которым он случайно запускается.
	const r = await invoke(p.bin, ["garage", "export"], { id: p.id })
	passNoise(p.id, r, ctx.warn)
	// Подпись та же, что у жёлтых строк списка: имя виноватого один раз и
	// подсказка про вход, если сайт просит логин.
	if (!r.ok) throw new ProviderError(r.error.code, failureText({ provider: p.id, code: r.error.code, message: r.error.message }))

	const { garage, added, updated } = mergeImported(await loadGarage(), p.id, parseCars(r.json, p.id))
	await saveGarage(garage)
	return {
		json: { provider: p.id, added, updated, cars: garage.cars },
		render: () => `${dim(`с ${p.id}: добавлено ${added}, обновлено ${updated}`)}\n${renderCars(garage.cars, garageCols(garage))}`,
	}
}

async function chooseMain(ctx: Ctx): Promise<Output> {
	const id = positiveInt("id машины", need(ctx.args[1], "id машины — колонка ID в adoc garage"))
	const garage = setMain(await loadGarage(), id)
	await saveGarage(garage)
	return { json: { ok: true, mainId: id }, render: () => renderCars(garage.cars, garageCols(garage)) }
}

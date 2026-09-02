// garage.ts — гараж живёт у пользователя, а не на сайтах. VIN и
// идентификаторы машин — личные данные: они показываются человеку и уходят
// сайту только тогда, когда он сам назвал машину аргументом команды. Сама
// обёртка никому их не рассылает.

import { ProviderError, brandKey } from "../sdk/index.ts"
import type { Car } from "../sdk/index.ts"
import { readJson, writeJson } from "./store.ts"

export const GARAGE_FILE = "garage.json"

/** В файле лежит VIN — читать его положено только владельцу. */
const GARAGE_MODE = 0o600

export type GarageCar = {
	id: number
	brand: string
	model: string
	modification?: string
	year?: number
	engine?: string
	vin?: string
	odometer?: number
	/** Идентификаторы сайтов: провайдер → его ref из `garage export`. */
	refs?: Record<string, Record<string, unknown>>
}

export type Garage = {
	mainId?: number
	/** Следующий свободный id. В старых файлах его нет — см. nextId(). */
	nextId?: number
	cars: GarageCar[]
}

export const loadGarage = async (): Promise<Garage> => (await readJson<Garage>(GARAGE_FILE)) ?? { cars: [] }
export const saveGarage = (g: Garage): Promise<void> => writeJson(GARAGE_FILE, g, GARAGE_MODE)

// Счётчик в файле, а не максимум по списку: после удаления двух последних
// машин максимум откатился бы назад, и новая машина получила бы номер уже
// удалённой — а он остался и в истории команд, и в заметках владельца. В
// файле, где счётчика ещё нет, он один раз считается по максимуму и дальше
// живёт вместе с гаражом.
const nextId = (g: Garage): number => g.nextId ?? g.cars.reduce((m, c) => Math.max(m, c.id), 0) + 1

/** Чужой id — не «нет такой машины», а «вот какие есть»: список короткий. */
function noSuchCar(g: Garage, id: number): ProviderError {
	const have = g.cars.length ? `в гараже ${g.cars.map(c => c.id).join(", ")}` : "гараж пуст"
	return new ProviderError("bad_args", `нет машины ${id} — ${have}, смотри adoc garage`)
}

export function addCar(g: Garage, car: Omit<GarageCar, "id">): { garage: Garage; car: GarageCar } {
	const added: GarageCar = { id: nextId(g), ...car }
	// Первая машина сама становится основной: гараж из одной машины без
	// основной — лишний вопрос к пользователю.
	return { garage: { mainId: g.mainId ?? added.id, nextId: added.id + 1, cars: [...g.cars, added] }, car: added }
}

export function removeCar(g: Garage, id: number): Garage {
	if (!g.cars.some(c => c.id === id)) throw noSuchCar(g, id)
	const cars = g.cars.filter(c => c.id !== id)
	const mainId = g.mainId === id ? cars[0]?.id : g.mainId
	// Счётчик переживает удаление — в нём весь смысл: номер удалённой машины
	// больше никому не достанется.
	return { ...(mainId === undefined ? {} : { mainId }), nextId: nextId(g), cars }
}

export function setMain(g: Garage, id: number): Garage {
	if (!g.cars.some(c => c.id === id)) throw noSuchCar(g, id)
	return { ...g, mainId: id }
}

/** Один и тот же VIN люди и сайты пишут по-разному: сравниваем нормализованный. */
const vinKey = (v: string | undefined): string => (v ?? "").trim().toUpperCase()

// Проверка нарочно грубая: 17 знаков без I, O и Q — это правило стандарта, а
// не догадка про конкретный завод. Дальше лезть нельзя: чужой VIN, забракованный
// обёрткой, дороже, чем опечатка, доехавшая до таблицы.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/

/** VIN из аргумента пользователя: нормализованный или bad_args. */
export function checkVin(v: string): string {
	const vin = vinKey(v)
	if (!VIN_RE.test(vin)) throw new ProviderError("bad_args", `--vin: VIN — это 17 знаков без букв I, O и Q, а не «${v.trim()}»`)
	return vin
}

/** Машина с таким VIN, если она уже есть: VIN — единственный настоящий идентификатор. */
export const findByVin = (g: Garage, vin: string): GarageCar | undefined =>
	(vinKey(vin) ? g.cars.find(c => vinKey(c.vin) === vinKey(vin)) : undefined)

const roughKey = (c: { brand: string; model: string; year?: number }): string =>
	`${brandKey(c.brand)}|${brandKey(c.model)}|${c.year ?? ""}`

/**
 * Слияние импорта. VIN — единственный настоящий идентификатор автомобиля,
 * поэтому сначала он. Не нашёлся — смотрим на свою машину без VIN с той же
 * маркой, моделью и годом: это она и есть, просто VIN в неё не вписали, и
 * импорт его дополняет. Второй строкой тот же автомобиль не заводится.
 * Свои поля при этом не затираются: пользователь мог поправить их руками, а
 * сайт мог их и не знать.
 */
export function mergeImported(g: Garage, provider: string, cars: Car[]): { garage: Garage; added: number; updated: number } {
	let out = g
	let added = 0
	let updated = 0
	for (const car of cars) {
		const vin = vinKey(car.vin)
		// Своих безвинных с тем же ключом может оказаться две — тогда VIN
		// достаётся первой: марка, модель и год их не различают, и угадывать
		// за владельца, какая из них какая, обёртке нечем.
		const rough = out.cars.find(c => !vinKey(c.vin) && roughKey(c) === roughKey(car))
		const hit = vin ? out.cars.find(c => vinKey(c.vin) === vin) ?? rough : rough
		if (!hit) {
			out = addCar(out, {
				brand: car.brand, model: car.model, modification: car.modification, year: car.year,
				engine: car.engine, vin: car.vin, odometer: car.odometer, refs: { [provider]: car.ref },
			}).garage
			added++
			continue
		}
		const merged: GarageCar = {
			...hit,
			modification: hit.modification ?? car.modification,
			year: hit.year ?? car.year,
			engine: hit.engine ?? car.engine,
			vin: hit.vin ?? car.vin,
			odometer: hit.odometer ?? car.odometer,
			refs: { ...hit.refs, [provider]: car.ref },
		}
		out = { ...out, cars: out.cars.map(c => (c.id === hit.id ? merged : c)) }
		updated++
	}
	return { garage: out, added, updated }
}

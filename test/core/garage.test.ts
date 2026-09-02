import { describe, expect, test } from "bun:test"
import { addCar, checkVin, findByVin, mergeImported, removeCar, setMain, type Garage } from "../../src/core/garage.ts"

const octavia = { brand: "SKODA", model: "OCTAVIA III", year: 2017, vin: "TMBAG7NE0H0000001" }
const ref = { id: "x" }

describe("гараж", () => {
	test("первая машина сама становится основной", () => {
		const { garage, car } = addCar({ cars: [] }, octavia)
		expect(car.id).toBe(1)
		expect(garage.mainId).toBe(1)
	})

	test("id выдаётся за максимальным, а не по длине списка", () => {
		const g: Garage = { mainId: 5, cars: [{ id: 5, brand: "A", model: "B" }] }
		expect(addCar(g, octavia).car.id).toBe(6)
	})

	test("удаление основной передаёт звезду первой оставшейся", () => {
		let g = addCar({ cars: [] }, octavia).garage
		g = addCar(g, { brand: "VW", model: "GOLF" }).garage
		const after = removeCar(g, 1)
		expect(after.cars.map(c => c.id)).toEqual([2])
		expect(after.mainId).toBe(2)
	})

	test("удаление последней оставляет пустой гараж без основной", () => {
		const g = addCar({ cars: [] }, octavia).garage
		expect(removeCar(g, 1)).toEqual({ cars: [] })
	})

	test("main и rm по несуществующему id — bad_args", () => {
		const g = addCar({ cars: [] }, octavia).garage
		expect(() => setMain(g, 7)).toThrow("нет машины 7")
		expect(() => removeCar(g, 7)).toThrow("нет машины 7")
	})

	test("сообщение про чужой id перечисляет свои", () => {
		let g = addCar({ cars: [] }, octavia).garage
		g = addCar(g, { brand: "VW", model: "GOLF" }).garage
		expect(() => setMain(g, 7)).toThrow("1, 2")
		expect(() => setMain({ cars: [] }, 7)).toThrow("гараж пуст")
	})

	test("main переставляет звезду", () => {
		let g = addCar({ cars: [] }, octavia).garage
		g = addCar(g, { brand: "VW", model: "GOLF" }).garage
		expect(setMain(g, 2).mainId).toBe(2)
	})
})

describe("VIN", () => {
	test("края и регистр приводятся к одному виду", () => {
		expect(checkVin(" tmbag7ne0h0000001 ")).toBe("TMBAG7NE0H0000001")
	})

	test("не 17 знаков — bad_args", () => {
		expect(() => checkVin("TMBAG7NE0H000001")).toThrow("VIN")
		expect(() => checkVin("TMBAG7NE0H00000012")).toThrow("VIN")
	})

	test("буквы I, O и Q в VIN не встречаются", () => {
		expect(() => checkVin("TMBAG7NE0H000000O")).toThrow("VIN")
		expect(() => checkVin("TMBAG7NE0H000000I")).toThrow("VIN")
		expect(() => checkVin("TMBAG7NE0H000000Q")).toThrow("VIN")
	})

	test("поиск по VIN не смотрит на регистр и пробелы", () => {
		const g = addCar({ cars: [] }, { brand: "SKODA", model: "OCTAVIA", vin: "tmbag7ne0h0000001" }).garage
		expect(findByVin(g, " TMBAG7NE0H0000001 ")?.id).toBe(1)
		expect(findByVin(g, "TMBAG7NE0H0000002")).toBeUndefined()
	})
})

describe("mergeImported", () => {
	test("незнакомая машина добавляется вместе со ссылкой сайта", () => {
		const r = mergeImported({ cars: [] }, "alpha", [{ ...octavia, ref }])
		expect(r.added).toBe(1)
		expect(r.updated).toBe(0)
		expect(r.garage.mainId).toBe(1)
		expect(r.garage.cars[0]!.refs).toEqual({ alpha: ref })
	})

	test("совпадение по VIN дополняет пустое, но не затирает своё", () => {
		const g = addCar({ cars: [] }, { brand: "SKODA", model: "OCTAVIA", year: 2016, vin: "tmbag7ne0h0000001" }).garage
		const r = mergeImported(g, "alpha", [{ brand: "SKODA", model: "OCTAVIA III", year: 2017, engine: "1.4 TSI", vin: "TMBAG7NE0H0000001", ref }])
		expect(r.added).toBe(0)
		expect(r.updated).toBe(1)
		expect(r.garage.cars).toHaveLength(1)
		const c = r.garage.cars[0]!
		expect(c.year).toBe(2016)
		expect(c.engine).toBe("1.4 TSI")
		expect(c.refs).toEqual({ alpha: ref })
	})

	test("без VIN с обеих сторон сходятся марка, модель и год", () => {
		const g = addCar({ cars: [] }, { brand: "vw", model: "golf", year: 2012 }).garage
		const r = mergeImported(g, "alpha", [{ brand: "VW", model: "GOLF", year: 2012, ref }])
		expect(r.updated).toBe(1)
		expect(r.garage.cars).toHaveLength(1)
	})

	test("своя машина с VIN не склеивается с безвинной из импорта", () => {
		const g = addCar({ cars: [] }, octavia).garage
		const r = mergeImported(g, "alpha", [{ brand: "SKODA", model: "OCTAVIA III", year: 2017, ref }])
		expect(r.added).toBe(1)
		expect(r.garage.cars.map(c => c.id)).toEqual([1, 2])
	})

	test("ссылки разных сайтов лежат рядом", () => {
		const one = mergeImported({ cars: [] }, "alpha", [{ ...octavia, ref }]).garage
		const two = mergeImported(one, "beta", [{ ...octavia, ref: { code: 7 } }]).garage
		expect(two.cars[0]!.refs).toEqual({ alpha: ref, beta: { code: 7 } })
	})
})

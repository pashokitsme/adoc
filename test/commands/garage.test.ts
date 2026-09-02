import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV, accountStore } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { GARAGE_FILE, type Garage } from "../../src/core/garage.ts"
import { filePath, readJson } from "../../src/core/store.ts"

let dir: string
let color: string | undefined
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-garage-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	// Таблицы сверяются как текст: цвета из TTY ломали бы toContain.
	color = process.env.NO_COLOR
	process.env.NO_COLOR = "1"
	// `garage export` у фикстур помечен auth: без аккаунта импортировать нечего.
	await accountStore("alpha").save({ token: "t", user: "pavel" })
	await accountStore("beta").save({ token: "t", user: "pavel" })
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	if (color === undefined) delete process.env.NO_COLOR
	else process.env.NO_COLOR = color
	delete process.env.FAKE_ALPHA_NOGARAGE
	await rm(dir, { recursive: true, force: true })
})

const add = (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => run(["garage", "add", ...args])

describe("adoc garage", () => {
	test("пустой гараж — не ошибка", async () => {
		const r = await run(["garage"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("гараж пуст")
	})

	test("add кладёт машину в garage.json и печатает её", async () => {
		const r = await add(["--brand", "SKODA", "--model", "OCTAVIA III", "--year", "2017", "--vin", "TMBAG7NE0H0000001", "--odometer", "0"])
		expect(r.code).toBe(0)
		const g = await readJson<Garage>(GARAGE_FILE)
		expect(g!.cars).toEqual([{ id: 1, brand: "SKODA", model: "OCTAVIA III", year: 2017, vin: "TMBAG7NE0H0000001", odometer: 0 }])
		expect(g!.mainId).toBe(1)
	})

	test("garage.json пишется только для владельца: в нём VIN", async () => {
		await add(["--brand", "SKODA", "--model", "OCTAVIA"])
		expect(((await stat(filePath(GARAGE_FILE))).mode & 0o777).toString(8)).toBe("600")
	})

	test("add без марки или модели — bad_args", async () => {
		expect(JSON.parse((await run(["garage", "add", "--brand", "SKODA", "--json"])).stdout).error.code).toBe("bad_args")
		expect(JSON.parse((await run(["garage", "add", "--model", "OCTAVIA", "--json"])).stdout).error.code).toBe("bad_args")
	})

	test("--year не число — bad_args", async () => {
		expect(JSON.parse((await add(["--brand", "A", "--model", "B", "--year", "позавчера", "--json"])).stdout).error.code).toBe("bad_args")
	})

	test("VIN приводится к верхнему регистру, мусорный — bad_args", async () => {
		await add(["--brand", "SKODA", "--model", "OCTAVIA", "--vin", " tmbag7ne0h0000001 "])
		expect((await readJson<Garage>(GARAGE_FILE))!.cars[0]!.vin).toBe("TMBAG7NE0H0000001")
		const bad = JSON.parse((await add(["--brand", "VW", "--model", "GOLF", "--vin", "не-вин", "--json"])).stdout)
		expect(bad.error.code).toBe("bad_args")
		expect(bad.error.message).toContain("VIN")
	})

	test("тот же VIN второй раз — bad_args с номером старой машины", async () => {
		await add(["--brand", "SKODA", "--model", "OCTAVIA", "--vin", "TMBAG7NE0H0000001"])
		const r = JSON.parse((await add(["--brand", "SKODA", "--model", "OCTAVIA III", "--vin", "tmbag7ne0h0000001", "--json"])).stdout)
		expect(r.error.code).toBe("bad_args")
		expect(r.error.message).toContain("машина 1")
		expect((await readJson<Garage>(GARAGE_FILE))!.cars).toHaveLength(1)
	})

	test("список показывает звезду у основной и VIN как есть", async () => {
		await add(["--brand", "SKODA", "--model", "OCTAVIA III", "--vin", "TMBAG7NE0H0000001"])
		const r = await run(["garage"])
		expect(r.stdout).toContain("★")
		expect(r.stdout).toContain("TMBAG7NE0H0000001")
	})

	test("main переставляет основную, rm удаляет", async () => {
		await add(["--brand", "SKODA", "--model", "OCTAVIA"])
		await add(["--brand", "VW", "--model", "GOLF"])
		expect((await run(["garage", "main", "2", "--json"])).code).toBe(0)
		expect((await readJson<Garage>(GARAGE_FILE))!.mainId).toBe(2)
		expect((await run(["garage", "rm", "1", "--json"])).code).toBe(0)
		expect((await readJson<Garage>(GARAGE_FILE))!.cars.map(c => c.id)).toEqual([2])
	})

	test("main без id и с чужим id — bad_args", async () => {
		expect(JSON.parse((await run(["garage", "main", "--json"])).stdout).error.code).toBe("bad_args")
		expect(JSON.parse((await run(["garage", "main", "42", "--json"])).stdout).error.code).toBe("bad_args")
	})

	test("id машины не число — bad_args", async () => {
		await add(["--brand", "SKODA", "--model", "OCTAVIA"])
		expect(JSON.parse((await run(["garage", "rm", "первая", "--json"])).stdout).error.code).toBe("bad_args")
	})

	test("--json отдаёт весь гараж", async () => {
		await add(["--brand", "SKODA", "--model", "OCTAVIA"])
		const j = JSON.parse((await run(["garage", "--json"])).stdout) as Garage
		expect(j.cars[0]!.brand).toBe("SKODA")
	})

	test("неизвестная подкоманда", async () => {
		expect(JSON.parse((await run(["garage", "нетакой", "--json"])).stdout).error.message).toContain("нетакой")
	})
})

type ImportJson = { provider: string; added: number; updated: number; cars: Garage["cars"] }

describe("adoc garage import", () => {
	test("импорт с одного сайта, потом со второго — одна машина и две связи", async () => {
		const first = JSON.parse((await run(["garage", "import", "alpha", "--json"])).stdout) as ImportJson
		expect(first.provider).toBe("alpha")
		expect(first.added).toBe(1)
		expect(first.updated).toBe(0)
		expect(first.cars[0]!.vin).toBe("TMBAG7NE0H0000001")
		expect(first.cars[0]!.refs).toEqual({ alpha: { carId: 1, source: "alpha" } })

		const second = JSON.parse((await run(["garage", "import", "beta", "--json"])).stdout) as ImportJson
		expect(second.added).toBe(0)
		expect(second.updated).toBe(1)
		expect(second.cars).toHaveLength(1)
		// Ref каждого сайта лежит под своим именем: по нему следующая команда
		// этого сайта найдёт машину у него, а не у соседа.
		expect(second.cars[0]!.refs).toEqual({ alpha: { carId: 1, source: "alpha" }, beta: { carId: 1, source: "beta" } })
		expect((await readJson<Garage>(GARAGE_FILE))!.cars).toHaveLength(1)
	})

	test("человеку — счёт добавленных и обновлённых с таблицей", async () => {
		await run(["garage", "import", "alpha"])
		const r = await run(["garage", "import", "beta"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("добавлено 0, обновлено 1")
		expect(r.stdout).toContain("alpha, beta")
	})

	test("своя машина без VIN дополняется, а не двоится", async () => {
		await add(["--brand", "SKODA", "--model", "OCTAVIA III", "--year", "2017", "--odometer", "120000"])
		const r = JSON.parse((await run(["garage", "import", "alpha", "--json"])).stdout) as ImportJson
		expect(r.added).toBe(0)
		expect(r.cars).toHaveLength(1)
		expect(r.cars[0]!.vin).toBe("TMBAG7NE0H0000001")
		expect(r.cars[0]!.odometer).toBe(120000)
	})

	test("сайт требует входа — ошибка провайдера доносится как есть", async () => {
		await accountStore("alpha").clear()
		const r = await run(["garage", "import", "alpha", "--json"])
		expect(r.code).toBe(1)
		const e = JSON.parse(r.stdout) as { error: { code: string; message: string } }
		expect(e.error.code).toBe("auth")
		// Правило подписи одно на всю обёртку: имя один раз и подсказка про вход.
		expect(e.error.message).toBe("alpha: нужен вход — adoc login alpha")
	})

	test("импорт без имени провайдера и с чужим — bad_args", async () => {
		expect(JSON.parse((await run(["garage", "import", "--json"])).stdout).error.code).toBe("bad_args")
		const e = JSON.parse((await run(["garage", "import", "gamma", "--json"])).stdout) as { error: { code: string; message: string } }
		expect(e.error.code).toBe("bad_args")
		expect(e.error.message).toContain("alpha, beta")
	})

	test("сайт без гаража — bad_args с названием умения", async () => {
		process.env.FAKE_ALPHA_NOGARAGE = "1"
		const e = JSON.parse((await run(["garage", "import", "alpha", "--json"])).stdout) as { error: { code: string; message: string } }
		expect(e.error.code).toBe("bad_args")
		expect(e.error.message).toContain("alpha не умеет garage")
	})
})

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV, ProviderError, accountStore } from "../../src/sdk/index.ts"
import { filePath, listAccountIds, readJson, removeAccount, writeJson } from "../../src/core/store.ts"

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-store-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

describe("readJson/writeJson", () => {
	test("нет файла — null", async () => {
		expect(await readJson("garage.json")).toBeNull()
	})

	test("запись и чтение", async () => {
		await writeJson("garage.json", { cars: [{ id: 1 }] })
		expect(filePath("garage.json")).toBe(join(dir, "garage.json"))
		expect(await readJson<{ cars: { id: number }[] }>("garage.json")).toEqual({ cars: [{ id: 1 }] })
	})

	test("битый JSON читается как null, а не роняет команду", async () => {
		await Bun.write(filePath("garage.json"), "{не json")
		expect(await readJson("garage.json")).toBeNull()
	})

	test("запись атомарна: временных файлов не остаётся", async () => {
		await writeJson("last-part.json", { article: "N1" })
		expect((await readdir(dir)).filter(n => n.includes(".tmp"))).toEqual([])
	})

})

describe("аккаунты", () => {
	test("пустой каталог — пустой список", async () => {
		expect(await listAccountIds()).toEqual([])
	})

	test("перечисление по именам файлов, отсортировано", async () => {
		await accountStore("beta").save({ t: 1 })
		await accountStore("alpha").save({ t: 2 })
		await Bun.write(join(dir, "accounts", "README"), "не аккаунт")
		expect(await listAccountIds()).toEqual(["alpha", "beta"])
	})

	test("удаление аккаунта", async () => {
		await accountStore("alpha").save({ t: 1 })
		expect(await removeAccount("alpha")).toBe(true)
		expect(await removeAccount("alpha")).toBe(false)
		expect(await listAccountIds()).toEqual([])
	})

	test("не ENOENT — ошибка наружу, а не тихое «файла не было»", async () => {
		// Каталог вместо файла: unlink отвечает EPERM/EISDIR. Соврать здесь
		// «аккаунта и не было» значит оставить токены на диске после logout.
		await mkdir(join(dir, "accounts", "alpha.json"), { recursive: true })
		await expect(removeAccount("alpha")).rejects.toThrow()
	})
})

describe("валидация id провайдера", () => {
	// `adoc logout <id>` берёт id прямо из аргументов пользователя, поэтому
	// removeAccount("../garage") без проверки удалил бы garage.json обёртки.
	for (const id of ["../x", "a/b", "", ".hidden"]) {
		test(`«${id}» — bad_args, а не удаление чужого файла`, async () => {
			const e = await removeAccount(id).then(() => null, (err: unknown) => err)
			expect(e).toBeInstanceOf(ProviderError)
			expect((e as ProviderError).code).toBe("bad_args")
		})
	}

	test("нормальные id проходят", async () => {
		await accountStore("autodoc").save({ t: 1 })
		await accountStore("my-shop_2").save({ t: 2 })
		expect(await removeAccount("autodoc")).toBe(true)
		expect(await removeAccount("my-shop_2")).toBe(true)
	})

	test("id вида ../garage не трогает файлы обёртки", async () => {
		await writeJson("garage.json", { cars: [] })
		await removeAccount("../garage").catch(() => {})
		expect(await readJson<{ cars: unknown[] }>("garage.json")).toEqual({ cars: [] })
	})
})

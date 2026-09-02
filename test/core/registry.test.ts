import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discover, PROVIDERS_DIR_ENV, select, type Provider } from "../../src/core/registry.ts"
import { parseDescribe } from "../../src/core/validate.ts"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "providers")

const provider = (id: string, capabilities: ("reviews" | "garage" | "analogs" | "basket")[] = []): Provider => ({
	id, bin: ["bun", `/x/${id}/main.ts`], source: "dir",
	describe: { contract: 1, id, name: id, site: `https://${id}.example`, capabilities, commands: [] },
})

// PATH в тестах — только свой временный: настоящий PATH машины пришлось бы
// читать, и разработчик с установленным adoc-чем-нибудь ловил бы чужой провайдер.
async function withPath<T>(dir: string, fn: () => Promise<T>): Promise<T> {
	const path = process.env.PATH
	process.env.PATH = dir
	try {
		return await fn()
	} finally {
		process.env.PATH = path
	}
}

describe("discover", () => {
	afterEach(() => { delete process.env[PROVIDERS_DIR_ENV] })

	test("ADOC_PROVIDERS_DIR отменяет всё остальное", async () => {
		process.env[PROVIDERS_DIR_ENV] = FIXTURES
		const found = await discover()
		expect(found.map(p => p.id)).toEqual(["alpha", "beta"])
		expect(found[0]!.bin).toEqual(["bun", join(FIXTURES, "alpha", "main.ts")])
		expect(found[0]!.source).toBe("dir")
	})

	test("встроенные — по пути относительно src/core, запускаются через bun", async () => {
		const empty = await mkdtemp(join(tmpdir(), "adoc-empty-"))
		try {
			const found = await withPath(empty, discover)
			const ids = found.map(p => p.id)
			expect(ids).toContain("autodoc")
			expect(ids).toContain("armtek")
			const autodoc = found.find(p => p.id === "autodoc")!
			expect(autodoc.bin[0]).toBe("bun")
			expect(autodoc.bin[1]!.endsWith(join("src", "providers", "autodoc", "main.ts"))).toBe(true)
			expect(autodoc.source).toBe("bundled")
		} finally {
			await rm(empty, { recursive: true, force: true })
		}
	})

	test("adoc-* в PATH становятся провайдерами, встроенный с тем же id побеждает", async () => {
		const dir = await mkdtemp(join(tmpdir(), "adoc-path-"))
		try {
			await writeFile(join(dir, "adoc-ext"), "#!/bin/sh\necho '{}'\n")
			await chmod(join(dir, "adoc-ext"), 0o755)
			await writeFile(join(dir, "adoc-autodoc"), "#!/bin/sh\necho '{}'\n")
			await chmod(join(dir, "adoc-autodoc"), 0o755)
			await writeFile(join(dir, "adoc-noexec"), "не исполняемый")
			const found = await withPath(dir, discover)
			const ext = found.find(p => p.id === "ext")
			expect(ext).toBeDefined()
			expect(ext!.bin).toEqual([join(dir, "adoc-ext")])
			expect(ext!.source).toBe("path")
			expect(found.find(p => p.id === "noexec")).toBeUndefined()
			expect(found.find(p => p.id === "autodoc")!.source).toBe("bundled")
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test("id не по правилам — каталог пропускается, а не регистрируется", async () => {
		const dir = await mkdtemp(join(tmpdir(), "adoc-ids-"))
		try {
			for (const name of ["good", "Bad", "с пробелом", "_leading"]) {
				await mkdir(join(dir, name), { recursive: true })
				await writeFile(join(dir, name, "main.ts"), "export {}\n")
			}
			process.env[PROVIDERS_DIR_ENV] = dir
			const found = await discover()
			expect(found.map(p => p.id)).toEqual(["good"])
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})

	test("id не по правилам — исполняемый в PATH пропускается", async () => {
		const dir = await mkdtemp(join(tmpdir(), "adoc-path-ids-"))
		try {
			for (const name of ["adoc-ok", "adoc-BAD", "adoc-.."]) {
				await writeFile(join(dir, name), "#!/bin/sh\necho '{}'\n")
				await chmod(join(dir, name), 0o755)
			}
			const found = await withPath(dir, discover)
			expect(found.find(p => p.id === "ok")).toBeDefined()
			expect(found.find(p => p.id === "BAD")).toBeUndefined()
			expect(found.find(p => p.id === "..")).toBeUndefined()
		} finally {
			await rm(dir, { recursive: true, force: true })
		}
	})
})

describe("select", () => {
	const all = [provider("alpha", ["basket"]), provider("beta", ["reviews"])]

	test("без флагов — все", () => {
		expect(select(all, {}).map(p => p.id)).toEqual(["alpha", "beta"])
	})

	test("--only и синоним --providers", () => {
		expect(select(all, { only: "beta" }).map(p => p.id)).toEqual(["beta"])
		expect(select(all, { providers: "beta" }).map(p => p.id)).toEqual(["beta"])
		expect(select(all, { only: "alpha,beta" }).map(p => p.id)).toEqual(["alpha", "beta"])
	})

	test("--skip убирает", () => {
		expect(select(all, { skip: "alpha" }).map(p => p.id)).toEqual(["beta"])
	})

	test("неизвестный id — bad_args с перечислением известных", () => {
		expect(() => select(all, { only: "gamma" })).toThrow("gamma")
	})

	test("фильтр по capability", () => {
		expect(select(all, {}, "reviews").map(p => p.id)).toEqual(["beta"])
	})

	test("пустой выбор — понятная ошибка, а не пустая таблица", () => {
		expect(() => select(all, { only: "alpha" }, "reviews")).toThrow("reviews")
	})
})

describe("parseDescribe", () => {
	test("нормальный describe", () => {
		const d = parseDescribe({ contract: 1, id: "alpha", name: "Alpha", site: "https://a", capabilities: ["basket"], commands: [{ name: "basket add", usage: "basket add --ref <json>", about: "положить", auth: true }] }, "alpha")
		expect(d.capabilities).toEqual(["basket"])
		expect(d.commands[0]!.name).toBe("basket add")
	})

	test("чужая версия контракта — отказ", () => {
		expect(() => parseDescribe({ contract: 2, id: "a", name: "A", site: "s", capabilities: [], commands: [] }, "a")).toThrow("контракт")
	})

	test("id не совпал с именем бинаря — отказ", () => {
		expect(() => parseDescribe({ contract: 1, id: "b", name: "A", site: "s", capabilities: [], commands: [] }, "a")).toThrow("id")
	})

	test("нет обязательного поля — отказ, и назван именно он", () => {
		expect(() => parseDescribe({ contract: 1, id: "a" }, "a")).toThrow("нет поля name")
		expect(() => parseDescribe({ contract: 1, id: "a", name: "A", site: "s", capabilities: [] }, "a")).toThrow("commands")
	})

	test("незнакомая capability отбрасывается, а не роняет провайдера", () => {
		const d = parseDescribe({ contract: 1, id: "a", name: "A", site: "s", capabilities: ["basket", "телепортация"], commands: [] }, "a")
		expect(d.capabilities).toEqual(["basket"])
	})
})

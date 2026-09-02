import { describe, expect, test } from "bun:test"
import { fitsVerdict, THIN_CATEGORY } from "../../src/sdk/fits.ts"

const scan = (over: Partial<Parameters<typeof fitsVerdict>[0]> = {}) => fitsVerdict({
	found: false, brandSeen: true, total: 200, scanned: 200, complete: true,
	where: "Опоры амортизаторов", brand: "FAG", ...over,
})

describe("правила применимости", () => {
	test("нашли — «подходит», и никаких оговорок", () => {
		expect(scan({ found: true }).fits).toBe(true)
	})

	test("просмотрели не всё — «не знаю», а не «не подходит»", () => {
		const r = scan({ complete: false, scanned: 108 })
		expect(r.fits).toBeNull()
		expect(r.reason).toContain("108 из 200")
	})

	test("подбор-заглушка — «не знаю»: два десятка позиций это не каталог", () => {
		const r = scan({ total: THIN_CATEGORY - 1, scanned: THIN_CATEGORY - 1 })
		expect(r.fits).toBeNull()
		expect(r.reason).toContain("подбор сайта неполный")
	})

	test("бренда в подборе нет вовсе — «не знаю»: сайт его туда не заводил", () => {
		const r = scan({ brandSeen: false })
		expect(r.fits).toBeNull()
		expect(r.reason).toContain("FAG")
	})

	test("каталог полный, бренд в нём есть, номера нет — только тогда «не подходит»", () => {
		const r = scan()
		expect(r.fits).toBe(false)
		expect(r.reason).toContain("просмотрено 200")
	})
})

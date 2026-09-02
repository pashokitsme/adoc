# План A: SDK провайдера и autodoc на нём

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать `src/sdk/` — SDK, который превращает объект с реализацией контракта в CLI провайдера, — и перевести на него autodoc как самостоятельный бинарь `adoc-autodoc` со всеми контрактными командами (`describe`, `login`, `whoami`, `search`, `brands`, `offers`, `reviews`, `garage export`, `basket …`) и нынешними своими командами.

**Architecture:** Контракт живёт в типах `src/sdk/contract.ts`. `defineProvider` принимает объект с методами контракта и своими командами, `runProvider` делает из него CLI: разбор argv, `--json`, рендер, файл аккаунта, exit-коды. Провайдер autodoc — это нынешние `api.ts`/`auth.ts` плюс `map.ts` (сырые ответы → типы контракта) и `provider.ts` (объявление). Агрегатор `adoc` в этом плане не пишется (план B); чтобы тулза не ломалась, бинарь `adoc` временно указывает на провайдер autodoc.

**Tech Stack:** Bun 1.3, TypeScript strict, `bun test`, без внешних зависимостей в рантайме; `typescript` только как devDependency для `tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-09-01-multi-provider-design.md` — разделы «SDK провайдера», «Контракт v1», «Хранилище», «Провайдер autodoc».

## Global Constraints

- Имя тулзы пока `adoc`; единственная константа `TOOL` в `src/sdk/config.ts`, каталог конфига `$ADOC_CONFIG_DIR` → `$XDG_CONFIG_HOME/adoc` → `~/.config/adoc`.
- Файлы аккаунтов `accounts/<id>.json` с правами `0o600`; пароли на диск не пишутся.
- С `--json` в stdout ровно один JSON-объект и ничего больше; подсказки и прогресс — в stderr.
- Exit-коды: `0` успех (пустой результат — тоже `0`), `1` ошибка, `2` `ambiguous`.
- Ошибки провайдера — `{error: {code, message, items?}}`, коды `auth | http | notfound | tty | timeout | bad_args | internal | ambiguous`.
- Комментарии, сообщения пользователю и документация — по-русски, как в текущем коде. Идентификаторы — по-английски.
- Без сети в `bun test`. Живые проверки — вручную по чек-листу в конце.
- Один коммит на задачу; `bun test` и `bun run typecheck` зелёные перед каждым коммитом.

## Отступление от спеки, зафиксированное здесь

Спека говорит, что обёртка создаёт `accounts/<id>.json` из ответа `login`. Проще и безопаснее, чтобы провайдер сохранял аккаунт сам (SDK делает это в `login`), а обёртка только перечисляла и удаляла. Внешним провайдерам на других языках это тоже проще: один процесс владеет файлом. Задача 1 правит спеку.

## Структура файлов

```
src/sdk/
  contract.ts   типы контракта v1 и константа CONTRACT_VERSION
  keys.ts       articleKey / brandKey — нормализация для склейки
  config.ts     TOOL, CONFIG_DIR_ENV, configDir()
  account.ts    accountStore(id) — чтение/запись accounts/<id>.json, 600
  cli.ts        parseArgv, readLine, readSecret, hasTTY
  errors.ts     ProviderError, exitCode, errorBody
  render.ts     нынешний src/render.ts + renderProducts/Brands/Offers/Reviews/Basket/Cars/Display
  http.ts       fetchJson с таймаутом, HttpError
  define.ts     типы ProviderSpec/Ctx/ProviderCommand, defineProvider
  run.ts        runProvider — argv → диспетчер → JSON или рендер → exit
  index.ts      публичная поверхность SDK
src/providers/autodoc/
  api.ts        нынешний src/api.ts + basketAdd/basketUpdate/basketDelete
  auth.ts       нынешний src/auth.ts, хранение через accountStore + миграция token.json
  brand.ts      артикул → производитель по id или имени
  map.ts        сырые ответы autodoc → типы контракта
  provider.ts   defineProvider({...})
  commands.ts   свои команды: goods, info, prices, analogs, favorites, orders, profile, garage, get, post
  main.ts       runProvider(autodoc)
test/
  sdk/*.test.ts
  providers/autodoc/*.test.ts
  fixtures/fake-provider.ts
  fixtures/autodoc/*.json, fixtures/autodoc/http/*.json
```

---

### Task 1: Инструменты, скрипты, правка спеки

**Files:**
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-09-01-multi-provider-design.md`

**Interfaces:**
- Produces: `bun test`, `bun run typecheck`.

- [ ] **Step 1: Скрипты и devDependencies**

`package.json` целиком:

```json
{
	"name": "adoc",
	"version": "2.0.0-dev",
	"private": true,
	"type": "module",
	"description": "Агрегатор магазинов автозапчастей: autodoc.ru, armtek.ru",
	"bin": {
		"adoc": "./src/main.ts",
		"adoc-autodoc": "./src/providers/autodoc/main.ts"
	},
	"scripts": {
		"test": "bun test",
		"typecheck": "tsc --noEmit"
	},
	"devDependencies": {
		"@types/bun": "latest",
		"typescript": "^5.6.0"
	},
	"engines": {
		"bun": ">=1.3.0"
	}
}
```

- [ ] **Step 2: Установить и проверить**

Run: `bun install && bun run typecheck && bun test`
Expected: `typecheck` без ошибок на текущем коде; `bun test` печатает `0 pass` (тестов ещё нет) и не падает.

- [ ] **Step 3: Правка спеки про владение файлом аккаунта**

В разделе «Контракт v1 → Правила для провайдеров» заменить строку

```
- Аккаунт: `accounts/<id>.json` в `ADOC_CONFIG_DIR`. Провайдер читает и
  обновляет его сам (refresh-токены), права 600. Обёртка создаёт его из ответа
  `login`, удаляет при `logout`, перечисляет в `accounts`. Содержимое файла —
  дело провайдера.
```

на

```
- Аккаунт: `accounts/<id>.json` в `ADOC_CONFIG_DIR`. Провайдер владеет файлом
  целиком: создаёт его в `login`, читает и обновляет (refresh-токены), права
  600. Обёртка только перечисляет файлы в `accounts` и удаляет при `logout`.
  Содержимое файла — дело провайдера; в ответе `login` поле `account` —
  копия того, что записано, для обёртки оно непрозрачно.
```

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock docs/superpowers/specs/2026-09-01-multi-provider-design.md
git commit -m "chore: test and typecheck scripts, typescript devDependency, spec: provider owns its account file"
```

---

### Task 2: Типы контракта и ключи склейки

**Files:**
- Create: `src/sdk/contract.ts`
- Create: `src/sdk/keys.ts`
- Test: `test/sdk/keys.test.ts`

**Interfaces:**
- Produces: все типы контракта (ниже), `CONTRACT_VERSION = 1`, `articleKey(s): string`, `brandKey(s): string`.

- [ ] **Step 1: Тест ключей**

`test/sdk/keys.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { articleKey, brandKey } from "../../src/sdk/keys.ts"

describe("articleKey", () => {
	test("регистр и разделители не важны", () => {
		expect(articleKey("n90954802")).toBe("N90954802")
		expect(articleKey("N 909 548 02")).toBe("N90954802")
		expect(articleKey("0 986 452 041")).toBe("0986452041")
		expect(articleKey("W712/75")).toBe("W71275")
	})
	test("кириллица сохраняется", () => {
		expect(articleKey("абв-12")).toBe("АБВ12")
	})
})

describe("brandKey", () => {
	test("регистр, края, внутренние пробелы и дефисы", () => {
		expect(brandKey("VAG")).toBe("VAG")
		expect(brandKey(" vag ")).toBe("VAG")
		expect(brandKey("Mann - Filter")).toBe("MANN FILTER")
		expect(brandKey("MANN-FILTER")).toBe("MANN FILTER")
		expect(brandKey("Bosch  ")).toBe("BOSCH")
	})
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/sdk/keys.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Написать `keys.ts` и `contract.ts`**

`src/sdk/keys.ts`:

```ts
// keys.ts — нормализация артикула и бренда для склейки между сайтами.
// Сайты пишут один и тот же артикул по-разному: `N90954802`, `N 909 548 02`,
// `0 986 452 041`. Ключ — только буквы и цифры в верхнем регистре.

export const articleKey = (s: string): string =>
	s.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "")

/** Бренд: регистр, края, внутренние пробелы и дефисы схлопываются в один пробел. */
export const brandKey = (s: string): string =>
	s.trim().toUpperCase().replace(/[\s-]+/g, " ")
```

`src/sdk/contract.ts`:

```ts
// contract.ts — контракт провайдера v1. Единственный источник правды по формам
// ответов — docs/contract.md; здесь то же самое типами. Агрегатор импортирует
// отсюда только типы.

export const CONTRACT_VERSION = 1 as const

export type Capability = "reviews" | "garage" | "analogs" | "basket"

export type Rating = { average: number; count: number }

/** Уже маскированные поля: провайдер не отдаёт наружу полный email и телефон. */
export type Display = { name: string; email?: string; phone?: string }

/** Результат поиска по названию. */
export type Product = {
	article: string
	brand: string
	name: string
	price?: number
	currency?: "RUB"
	quantity?: number
	rating?: Rating
	images?: string[]
	url?: string
	category?: string
	extra?: Record<string, unknown>
}

/** Кто выпускает артикул. `brand` — ключ склейки между сайтами. */
export type BrandHit = {
	brand: string
	article: string
	name?: string
	rating?: Rating
	images?: string[]
	extra?: Record<string, unknown>
}

export type Offer = {
	article: string
	brand: string
	name?: string
	price: number
	currency: "RUB"
	quantity?: number
	deliveryDays?: number
	deliveryDate?: string // YYYY-MM-DD
	seller?: string
	stock?: { code: string; name?: string }
	rating?: Rating
	images?: string[]
	url?: string
	ref?: Record<string, unknown> // что нужно сайту для basket add; обязателен при capability basket
	analog?: boolean
	analogOf?: { article: string; brand: string }
	extra?: Record<string, unknown>
}

export type Review = {
	author?: string
	date?: string // YYYY-MM-DD
	rating?: number // 1..5
	pros?: string
	cons?: string
	text: string
	purchased?: boolean
}

export type Reviews = {
	total: number
	rating?: Rating & { histogram?: number[] } // от 5★ к 1★
	summary?: { pros: string[]; cons: string[] }
	items: Review[]
}

export type BasketItem = {
	id: string
	article: string
	brand: string
	name?: string
	price: number
	quantity: number
	sum?: number
	seller?: string
	deliveryDays?: number
	deliveryDate?: string
	extra?: Record<string, unknown>
}

export type Basket = {
	items: BasketItem[]
	total?: number
	currency: "RUB"
	url?: string
}

export type Car = {
	brand: string
	model: string
	modification?: string
	year?: number
	engine?: string
	vin?: string
	odometer?: number
	ref: Record<string, unknown>
}

export type Command = { name: string; usage: string; about: string; auth: boolean }

export type Describe = {
	contract: typeof CONTRACT_VERSION
	id: string
	name: string
	site: string
	capabilities: Capability[]
	commands: Command[]
}

export type ErrorCode = "auth" | "http" | "notfound" | "tty" | "timeout" | "bad_args" | "internal" | "ambiguous"
export type ErrorBody = { error: { code: ErrorCode; message: string; items?: BrandHit[] } }

export type LoginResult = { account: unknown; display: Display }
export type WhoamiResult = { ok: boolean; display?: Display }
/** `extra` — провайдерское расширение (у autodoc — список найденных категорий). */
export type SearchResult = { items: Product[]; total?: number; extra?: Record<string, unknown> }
export type BrandsResult = { items: BrandHit[] }
export type OffersResult = { items: Offer[] }
export type CarsResult = { cars: Car[] }
```

- [ ] **Step 4: Тесты и типы зелёные**

Run: `bun test test/sdk/keys.test.ts && bun run typecheck`
Expected: PASS, typecheck чистый.

- [ ] **Step 5: Commit**

```bash
git add src/sdk/contract.ts src/sdk/keys.ts test/sdk/keys.test.ts
git commit -m "feat(sdk): contract v1 types and article/brand keys"
```

---

### Task 3: Конфиг и файл аккаунта

**Files:**
- Create: `src/sdk/config.ts`
- Create: `src/sdk/account.ts`
- Test: `test/sdk/account.test.ts`

**Interfaces:**
- Produces: `TOOL`, `CONFIG_DIR_ENV`, `configDir()`, `accountStore<A>(id): AccountStore<A>` с `path`, `load()`, `save(a)`, `clear()`.

- [ ] **Step 1: Тест**

`test/sdk/account.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV, configDir } from "../../src/sdk/config.ts"
import { accountStore } from "../../src/sdk/account.ts"

let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-test-"))
	process.env[CONFIG_DIR_ENV] = dir
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	await rm(dir, { recursive: true, force: true })
})

describe("configDir", () => {
	test("переменная окружения имеет приоритет", () => {
		expect(configDir()).toBe(dir)
	})
	test("без переменной — XDG_CONFIG_HOME/adoc", () => {
		delete process.env[CONFIG_DIR_ENV]
		process.env.XDG_CONFIG_HOME = "/x"
		expect(configDir()).toBe("/x/adoc")
		delete process.env.XDG_CONFIG_HOME
	})
})

describe("accountStore", () => {
	test("пустой стор отдаёт null", async () => {
		expect(await accountStore<{ t: string }>("demo").load()).toBeNull()
	})
	test("save/load/clear и права 600", async () => {
		const s = accountStore<{ t: string }>("demo")
		await s.save({ t: "x" })
		expect(s.path).toBe(join(dir, "accounts", "demo.json"))
		expect((await stat(s.path)).mode & 0o777).toBe(0o600)
		expect(await s.load()).toEqual({ t: "x" })
		await s.clear()
		expect(await s.load()).toBeNull()
		await s.clear() // второй раз — не ошибка
	})
	test("битый JSON читается как null", async () => {
		const s = accountStore("bad")
		await s.save({ ok: true })
		await Bun.write(s.path, "{not json")
		expect(await s.load()).toBeNull()
	})
})
```

- [ ] **Step 2: Убедиться, что падает**

Run: `bun test test/sdk/account.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Реализация**

`src/sdk/config.ts`:

```ts
// config.ts — имя тулзы и каталог конфига. Имя меняется здесь и в package.json.

import { homedir } from "node:os"
import { join } from "node:path"

export const TOOL = "adoc"
export const CONFIG_DIR_ENV = `${TOOL.toUpperCase()}_CONFIG_DIR`

/** $ADOC_CONFIG_DIR → $XDG_CONFIG_HOME/adoc → ~/.config/adoc */
export function configDir(): string {
	const env = process.env[CONFIG_DIR_ENV]
	if (env) return env
	return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), TOOL)
}
```

`src/sdk/account.ts`:

```ts
// account.ts — файл аккаунта провайдера: accounts/<id>.json с правами 600.
// Содержимое — дело провайдера; SDK гарантирует только путь и права.

import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { configDir } from "./config.ts"

export type AccountStore<A> = {
	readonly path: string
	load(): Promise<A | null>
	save(a: A): Promise<void>
	clear(): Promise<void>
}

export function accountStore<A = unknown>(id: string): AccountStore<A> {
	const path = join(configDir(), "accounts", `${id}.json`)
	return {
		path,
		async load() {
			try {
				return JSON.parse(await readFile(path, "utf8")) as A
			} catch {
				return null
			}
		},
		async save(a) {
			await mkdir(dirname(path), { recursive: true })
			// mode в writeFile действует только при создании, поэтому chmod следом
			await writeFile(path, JSON.stringify(a, null, 2), { mode: 0o600 })
			await chmod(path, 0o600)
		},
		async clear() {
			try { await unlink(path) } catch { /* уже нет */ }
		},
	}
}
```

Внимание: `path` вычисляется при создании стора, поэтому `accountStore()` зовут после того, как окружение известно (внутри функций, не на верхнем уровне модуля).

- [ ] **Step 4: Зелёные тесты**

Run: `bun test test/sdk/account.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sdk/config.ts src/sdk/account.ts test/sdk/account.test.ts
git commit -m "feat(sdk): config dir and per-provider account store"
```

---

### Task 4: Разбор argv и ввод с терминала

**Files:**
- Create: `src/sdk/cli.ts`
- Test: `test/sdk/cli.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `parseArgv(argv, valueFlags): { args: string[]; flags: Flags }`, `type Flags = Record<string, string | true>`, `readLine(prompt)`, `readSecret(prompt)`, `hasTTY()`. Подсказки уходят в **stderr**.

- [ ] **Step 1: Тест**

`test/sdk/cli.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { parseArgv } from "../../src/sdk/cli.ts"

describe("parseArgv", () => {
	test("позиционные и булевы флаги", () => {
		expect(parseArgv(["brands", "N1", "--json"], [])).toEqual({
			args: ["brands", "N1"], flags: { json: true },
		})
	})
	test("флаги со значением: отдельным аргументом и через =", () => {
		expect(parseArgv(["offers", "N1", "--brand", "VAG", "--limit=5"], ["brand", "limit"])).toEqual({
			args: ["offers", "N1"], flags: { brand: "VAG", limit: "5" },
		})
	})
	test("значение-флаг в конце без значения — пустая строка", () => {
		expect(parseArgv(["x", "--brand"], ["brand"]).flags.brand).toBe("")
	})
	test("-h и --help — help", () => {
		expect(parseArgv(["-h"], []).flags.help).toBe(true)
		expect(parseArgv(["--help"], []).flags.help).toBe(true)
	})
	test("значение с пробелами после = сохраняется целиком", () => {
		expect(parseArgv(["--brand=MANN FILTER"], ["brand"]).flags.brand).toBe("MANN FILTER")
	})
})
```

- [ ] **Step 2: Падает**

Run: `bun test test/sdk/cli.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 3: Реализация**

`src/sdk/cli.ts` — перенос из `src/main.ts` (разбор argv, `readLine`, `readSecret`) с двумя изменениями: подсказки пишутся в stderr, чтобы не засорять stdout при `--json`, и разбор argv стал функцией.

```ts
// cli.ts — argv и ввод с терминала. Подсказки идут в stderr: stdout при --json
// должен содержать ровно один JSON-объект.

export type Flags = Record<string, string | true>

export function parseArgv(argv: string[], valueFlags: string[]): { args: string[]; flags: Flags } {
	const flags: Flags = {}
	const args: string[] = []
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!
		if (a === "-h" || a === "--help") flags.help = true
		else if (a.startsWith("--")) {
			const eq = a.indexOf("=")
			const k = eq >= 0 ? a.slice(2, eq) : a.slice(2)
			if (eq >= 0) flags[k] = a.slice(eq + 1)
			else if (valueFlags.includes(k)) flags[k] = argv[++i] ?? ""
			else flags[k] = true
		} else args.push(a)
	}
	return { args, flags }
}

export const hasTTY = (): boolean => !!process.stdin.isTTY

// Построчное чтение stdin. Остаток буфера переживает вызов: пайп может
// прислать несколько строк одним куском, а закрытый поток не должен
// подвешивать процесс.
let leftover = ""
let stdinEnded = false

export function readLine(prompt: string): Promise<string> {
	process.stderr.write(prompt)
	const nl = leftover.indexOf("\n")
	if (nl >= 0) {
		const line = leftover.slice(0, nl)
		leftover = leftover.slice(nl + 1)
		return Promise.resolve(line)
	}
	if (stdinEnded) {
		const rest = leftover
		leftover = ""
		return Promise.resolve(rest)
	}
	return new Promise<string>(resolve => {
		process.stdin.setEncoding("utf8")
		const done = (v: string) => {
			process.stdin.off("data", onData)
			process.stdin.off("end", onEnd)
			process.stdin.pause()
			resolve(v)
		}
		const onData = (d: string) => {
			leftover += d
			const i = leftover.indexOf("\n")
			if (i < 0) return
			const line = leftover.slice(0, i)
			leftover = leftover.slice(i + 1)
			done(line)
		}
		const onEnd = () => {
			stdinEnded = true
			const rest = leftover
			leftover = ""
			done(rest)
		}
		process.stdin.on("data", onData)
		process.stdin.on("end", onEnd)
		process.stdin.resume()
	})
}

// Что бы ни случилось дальше, терминал не должен остаться без эха.
process.on("exit", () => {
	try { if (process.stdin.isTTY) process.stdin.setRawMode(false) } catch { /* уже закрыт */ }
})

/** Пароль с выключенным эхом. Никуда не сохраняется, только уходит в запрос. */
export async function readSecret(prompt: string): Promise<string> {
	if (!process.stdin.isTTY) return await readLine(prompt)
	process.stderr.write(prompt)
	process.stdin.setRawMode(true)
	process.stdin.resume()
	process.stdin.setEncoding("utf8")
	return new Promise<string>(resolve => {
		let buf = ""
		const finish = (v: string) => {
			process.stdin.off("data", onData)
			process.stdin.setRawMode(false)
			process.stdin.pause()
			process.stderr.write("\n")
			resolve(v)
		}
		const onData = (chunk: string) => {
			for (const c of chunk) {
				if (c === "\r" || c === "\n") return finish(buf)
				if (c === "\u0003") { process.stdin.setRawMode(false); process.stderr.write("\n"); process.exit(130) }
				if (c === "\u007f" || c === "\b") {
					if (buf) { buf = buf.slice(0, -1); process.stderr.write("\b \b") }
					continue
				}
				if (c < " ") continue // управляющие символы в пароль не пускаем
				buf += c
				process.stderr.write("•")
			}
		}
		process.stdin.on("data", onData)
	})
}
```

- [ ] **Step 4: Зелёные**

Run: `bun test test/sdk/cli.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sdk/cli.ts test/sdk/cli.test.ts
git commit -m "feat(sdk): argv parser and tty prompts on stderr"
```

---

### Task 5: Ошибки провайдера

**Files:**
- Create: `src/sdk/errors.ts`
- Test: `test/sdk/errors.test.ts`

**Interfaces:**
- Consumes: `ErrorCode`, `ErrorBody`, `BrandHit` из `contract.ts`.
- Produces: `class ProviderError extends Error { code; items? }`, `exitCode(code): 1 | 2`, `errorBody(e: unknown, map?): ErrorBody`, `toProviderError(e: unknown, map?): ProviderError`, `type ErrorMapper`.

- [ ] **Step 1: Тест**

`test/sdk/errors.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { ProviderError, errorBody, exitCode, toProviderError } from "../../src/sdk/errors.ts"

describe("ProviderError", () => {
	test("код и exit-код", () => {
		const e = new ProviderError("auth", "нужен вход")
		expect(e.code).toBe("auth")
		expect(exitCode(e.code)).toBe(1)
		expect(exitCode("ambiguous")).toBe(2)
	})
	test("errorBody для ProviderError с items", () => {
		const items = [{ brand: "VAG", article: "N1" }]
		expect(errorBody(new ProviderError("ambiguous", "уточни бренд", items)))
			.toEqual({ error: { code: "ambiguous", message: "уточни бренд", items } })
	})
	test("чужая ошибка — internal", () => {
		expect(errorBody(new Error("boom")).error).toEqual({ code: "internal", message: "boom" })
		expect(errorBody("строка").error).toEqual({ code: "internal", message: "строка" })
	})
	test("toProviderError уважает маппер провайдера", () => {
		const e = toProviderError(new Error("401"), err => err instanceof Error && err.message === "401"
			? new ProviderError("auth", "нужен вход") : null)
		expect(e.code).toBe("auth")
	})
})
```

- [ ] **Step 2: Падает**

Run: `bun test test/sdk/errors.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

`src/sdk/errors.ts`:

```ts
// errors.ts — ошибка провайдера и её вид наружу.

import type { BrandHit, ErrorBody, ErrorCode } from "./contract.ts"

export class ProviderError extends Error {
	constructor(readonly code: ErrorCode, message: string, readonly items?: BrandHit[]) {
		super(message)
	}
}

export const exitCode = (code: ErrorCode): 1 | 2 => (code === "ambiguous" ? 2 : 1)

export type ErrorMapper = (e: unknown) => ProviderError | null

export function toProviderError(e: unknown, map?: ErrorMapper): ProviderError {
	if (e instanceof ProviderError) return e
	const mapped = map?.(e)
	if (mapped) return mapped
	return new ProviderError("internal", e instanceof Error ? e.message : String(e))
}

export function errorBody(e: unknown, map?: ErrorMapper): ErrorBody {
	const pe = toProviderError(e, map)
	return { error: { code: pe.code, message: pe.message, ...(pe.items ? { items: pe.items } : {}) } }
}
```

- [ ] **Step 4: Зелёные, commit**

Run: `bun test test/sdk/errors.test.ts && bun run typecheck`

```bash
git add src/sdk/errors.ts test/sdk/errors.test.ts
git commit -m "feat(sdk): ProviderError, exit codes, error body"
```

---

### Task 6: Рендер: перенос и таблицы для типов контракта

**Files:**
- Move: `src/render.ts` → `src/sdk/render.ts`
- Modify: `src/main.ts` (импорт `./render.ts` → `./sdk/render.ts`)
- Test: `test/sdk/render.test.ts`

**Interfaces:**
- Consumes: типы контракта.
- Produces: всё нынешнее (`bold`, `dim`, `red`, `green`, `yellow`, `cyan`, `money`, `days`, `stars`, `bar`, `table`, `fold`, `heading`, `maskEmail`, `maskPhone`, `fields`, `rule`) плюс `renderProducts(items)`, `renderBrands(items)`, `renderOffers(items)`, `renderReviews(r)`, `renderBasket(b)`, `renderCars(cars)`, `renderDisplay(d)`, `isoDate(s)`.

- [ ] **Step 1: Перенос**

Run: `git mv src/render.ts src/sdk/render.ts && sed -i '' 's#from "./render.ts"#from "./sdk/render.ts"#' src/main.ts && bun run typecheck`
Expected: typecheck чистый, `bun src/main.ts part n90954802` работает как раньше.

- [ ] **Step 2: Тест новых рендеров**

`test/sdk/render.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { days, isoDate, renderBasket, renderOffers, renderReviews, table } from "../../src/sdk/render.ts"

// цвета гаснут вне TTY, так что строки сравниваются напрямую

describe("days", () => {
	test("склонение", () => {
		expect(days(0)).toBe("сегодня")
		expect(days(1)).toBe("1 день")
		expect(days(3)).toBe("3 дня")
		expect(days(11)).toBe("11 дней")
		expect(days(undefined)).toBe("—")
	})
})

describe("isoDate", () => {
	test("режет время", () => {
		expect(isoDate("2026-09-04T00:00:00")).toBe("2026-09-04")
		expect(isoDate(undefined)).toBeUndefined()
	})
})

describe("table", () => {
	test("выравнивает и обрезает хвост", () => {
		expect(table([["a", "bb"], ["ccc", "d"]], ["X", "Y"])).toBe("X    Y\na    bb\nccc  d")
	})
})

describe("renderOffers", () => {
	test("одна строка на предложение, аналог помечен", () => {
		const out = renderOffers([
			{ article: "N1", brand: "VAG", name: "Болт", price: 407, currency: "RUB", quantity: 100, deliveryDays: 3, seller: "Дилер" },
			{ article: "X2", brand: "FEBEST", name: "Болты", price: 916, currency: "RUB", deliveryDays: 2, analog: true },
		])
		const lines = out.split("\n")
		expect(lines[0]).toContain("БРЕНД")
		expect(lines[1]).toContain("407 ₽")
		expect(lines[1]).toContain("100 шт")
		expect(lines[1]).toContain("3 дня")
		expect(lines[2]).toContain("аналог")
	})
	test("пусто — заглушка", () => {
		expect(renderOffers([])).toBe("предложений нет")
	})
})

describe("renderBasket", () => {
	test("сумма и итог", () => {
		const out = renderBasket({ currency: "RUB", total: 814, items: [
			{ id: "1", article: "N1", brand: "VAG", price: 407, quantity: 2, sum: 814 },
		] })
		expect(out).toContain("814 ₽")
		expect(out).toContain("итого")
	})
})

describe("renderReviews", () => {
	test("выжимка и лента", () => {
		const out = renderReviews({ total: 1, rating: { average: 4.9, count: 56 },
			summary: { pros: ["Как оригинал."], cons: [] },
			items: [{ author: "Юрий Л.", rating: 5, text: "хороший товар", purchased: true }] })
		expect(out).toContain("отзывов: 1")
		expect(out).toContain("+ Как оригинал.")
		expect(out).toContain("хороший товар")
	})
})
```

- [ ] **Step 3: Падает**

Run: `bun test test/sdk/render.test.ts`
Expected: FAIL на `isoDate`/`renderOffers` (не экспортированы).

- [ ] **Step 4: Дописать рендеры в `src/sdk/render.ts`**

Импорт типов — в начало файла после шапки-комментария:

```ts
import type { Basket, BrandHit, Car, Display, Offer, Product, Reviews } from "./contract.ts"
```

Функции — в конец файла:

```ts
export const isoDate = (s: string | undefined): string | undefined => s?.slice(0, 10)

const ratingCell = (r: { average: number; count: number } | undefined) =>
	r && r.count ? `${r.average.toFixed(1)}★ (${r.count})` : dim("—")

const qtyCell = (q: number | undefined) => (q ? green(`${q} шт`) : dim("нет"))

export function renderProducts(items: Product[]): string {
	if (!items.length) return "ничего не найдено"
	return table(items.map(p => [
		cyan(p.article), bold(p.brand), p.name.slice(0, 50),
		money(p.price), qtyCell(p.quantity), ratingCell(p.rating),
	]), ["АРТИКУЛ", "БРЕНД", "НАЗВАНИЕ", "ОТ", "НАЛИЧИЕ", "РЕЙТИНГ"])
}

export function renderBrands(items: BrandHit[]): string {
	if (!items.length) return "не найдено"
	return table(items.map(b => [bold(b.brand), cyan(b.article), b.name ?? "", ratingCell(b.rating)]),
		["БРЕНД", "АРТИКУЛ", "НАЗВАНИЕ", "РЕЙТИНГ"])
}

export function renderOffers(items: Offer[]): string {
	if (!items.length) return "предложений нет"
	return table(items.map((o, i) => [
		String(i + 1), bold(o.brand), (o.name ?? "").slice(0, 40), money(o.price), qtyCell(o.quantity),
		o.deliveryDays != null ? days(o.deliveryDays) : (o.deliveryDate ?? dim("—")),
		o.seller ?? dim("—"), ratingCell(o.rating), o.analog ? yellow("аналог") : "",
	]), ["#", "БРЕНД", "НАЗВАНИЕ", "ЦЕНА", "НАЛИЧИЕ", "СРОК", "ПРОДАВЕЦ", "РЕЙТИНГ", ""])
}

export function renderReviews(r: Reviews): string {
	const out: string[] = [dim(`отзывов: ${r.total}`)]
	if (r.rating) out.push(`${stars(r.rating.average)}  ${bold(r.rating.average.toFixed(2))}  ${dim(`${r.rating.count} оценок`)}`)
	for (const l of bar(r.rating?.histogram)) out.push(l)
	if (r.summary && (r.summary.pros.length || r.summary.cons.length)) {
		out.push(heading("Выжимка"))
		for (const p of r.summary.pros) out.push(`  ${green("+")} ${p}`)
		for (const c of r.summary.cons) out.push(`  ${red("−")} ${c}`)
	}
	for (const it of r.items) {
		const who = [it.author, it.purchased ? "покупка подтверждена" : ""].filter(Boolean).join(" · ")
		out.push(heading(`${it.rating ? stars(it.rating) + "  " : ""}${who || "аноним"}`) + (it.date ? dim(`  ${it.date}`) : ""))
		if (it.pros) out.push(`  ${green("+")} ${it.pros}`)
		if (it.cons) out.push(`  ${red("−")} ${it.cons}`)
		if (it.text) out.push(fold(it.text))
	}
	return out.join("\n")
}

export function renderBasket(b: Basket): string {
	if (!b.items.length) return "корзина пуста"
	const rows = b.items.map((it, i) => [
		`${i + 1}`, dim(it.id), cyan(it.article), bold(it.brand), (it.name ?? "").slice(0, 36),
		money(it.price), `${it.quantity}`, money(it.sum ?? it.price * it.quantity),
		it.deliveryDays != null ? days(it.deliveryDays) : (it.deliveryDate ?? dim("—")),
	])
	const total = b.total ?? b.items.reduce((s, it) => s + (it.sum ?? it.price * it.quantity), 0)
	return table(rows, ["#", "ID", "АРТИКУЛ", "БРЕНД", "НАЗВАНИЕ", "ЦЕНА", "КОЛ", "СУММА", "СРОК"]) +
		`\n${dim("итого")}  ${bold(money(total))}`
}

export function renderCars(cars: Car[]): string {
	if (!cars.length) return "гараж пуст"
	return table(cars.map(c => [
		bold([c.brand, c.model].filter(Boolean).join(" ")), c.modification ?? c.engine ?? dim("—"),
		c.year ? String(c.year) : dim("—"), c.vin ?? dim("—"),
		c.odometer ? `${c.odometer.toLocaleString("ru-RU")} км` : dim("—"),
	]), ["АВТОМОБИЛЬ", "МОДИФИКАЦИЯ", "ГОД", "VIN", "ПРОБЕГ"])
}

export function renderDisplay(d: Display | null | undefined): string {
	if (!d) return dim("не авторизован")
	return fields([["имя", bold(d.name)], ["email", d.email ?? "—"], ["телефон", d.phone ?? "—"]])
}
```

- [ ] **Step 5: Зелёные, commit**

Run: `bun test test/sdk/render.test.ts && bun run typecheck`

```bash
git add -A src/sdk/render.ts src/main.ts test/sdk/render.test.ts
git commit -m "feat(sdk): move render into sdk, add renderers for contract types"
```

---

### Task 7: HTTP с таймаутом

**Files:**
- Create: `src/sdk/http.ts`
- Test: `test/sdk/http.test.ts`

**Interfaces:**
- Produces: `class HttpError extends Error { status; url; body }`, `fetchJson<T>(url, init?, opts?: { timeoutMs?: number }): Promise<T>` — бросает `HttpError` на не-2xx и на не-JSON, `ProviderError("timeout")` на таймаут; пустое тело — `null`.

- [ ] **Step 1: Тест**

`test/sdk/http.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { HttpError, fetchJson } from "../../src/sdk/http.ts"
import { ProviderError } from "../../src/sdk/errors.ts"

let server: ReturnType<typeof Bun.serve>
let base: string
beforeAll(() => {
	server = Bun.serve({
		port: 0,
		async fetch(req) {
			const u = new URL(req.url)
			if (u.pathname === "/ok") return Response.json({ a: 1 })
			if (u.pathname === "/empty") return new Response("")
			if (u.pathname === "/html") return new Response("<html>", { headers: { "content-type": "text/html" } })
			if (u.pathname === "/401") return new Response("", { status: 401 })
			if (u.pathname === "/slow") { await Bun.sleep(300); return Response.json({}) }
			return new Response("nope", { status: 404 })
		},
	})
	base = `http://localhost:${server.port}`
})
afterAll(() => server.stop(true))

describe("fetchJson", () => {
	test("json", async () => { expect(await fetchJson(`${base}/ok`)).toEqual({ a: 1 }) })
	test("пустое тело — null", async () => { expect(await fetchJson(`${base}/empty`)).toBeNull() })
	test("не JSON — HttpError со статусом 200", async () => {
		await expect(fetchJson(`${base}/html`)).rejects.toBeInstanceOf(HttpError)
	})
	test("401 — HttpError с status", async () => {
		const e = await fetchJson(`${base}/401`).catch(x => x)
		expect(e).toBeInstanceOf(HttpError)
		expect((e as HttpError).status).toBe(401)
	})
	test("таймаут — ProviderError timeout", async () => {
		const e = await fetchJson(`${base}/slow`, undefined, { timeoutMs: 50 }).catch(x => x)
		expect(e).toBeInstanceOf(ProviderError)
		expect((e as ProviderError).code).toBe("timeout")
	})
})
```

- [ ] **Step 2: Падает**

Run: `bun test test/sdk/http.test.ts`
Expected: FAIL.

- [ ] **Step 3: Реализация**

`src/sdk/http.ts`:

```ts
// http.ts — fetch с таймаутом и разбором JSON. Провайдер может им не
// пользоваться; autodoc держит свой call() и только мапит ошибки.

import { ProviderError } from "./errors.ts"

export class HttpError extends Error {
	constructor(readonly status: number, readonly url: string, readonly body: string) {
		super(`${url}: HTTP ${status}${body ? ` — ${body.slice(0, 200)}` : ""}`)
	}
}

export async function fetchJson<T = unknown>(
	url: string, init?: RequestInit, opts: { timeoutMs?: number } = {},
): Promise<T> {
	const timeoutMs = opts.timeoutMs ?? 20_000
	const ctl = new AbortController()
	const timer = setTimeout(() => ctl.abort(), timeoutMs)
	let res: Response
	try {
		res = await fetch(url, { ...init, signal: ctl.signal })
	} catch (e) {
		if (ctl.signal.aborted) throw new ProviderError("timeout", `${url}: нет ответа за ${timeoutMs} мс`)
		throw e
	} finally {
		clearTimeout(timer)
	}
	const text = await res.text()
	if (!res.ok) throw new HttpError(res.status, url, text)
	if (!text) return null as T
	try {
		return JSON.parse(text) as T
	} catch {
		throw new HttpError(res.status, url, `сервер вернул не JSON: ${text.slice(0, 120)}`)
	}
}
```

- [ ] **Step 4: Зелёные, commit**

Run: `bun test test/sdk/http.test.ts && bun run typecheck`

```bash
git add src/sdk/http.ts test/sdk/http.test.ts
git commit -m "feat(sdk): fetchJson with timeout and HttpError"
```

---

### Task 8: `defineProvider` и `runProvider`

**Files:**
- Create: `src/sdk/define.ts`
- Create: `src/sdk/run.ts`
- Create: `src/sdk/index.ts`
- Create: `test/fixtures/fake-provider.ts`
- Test: `test/sdk/run.test.ts`

**Interfaces:**
- Consumes: всё из задач 2–7.
- Produces:

```ts
type Ctx<A> = {
  account: A | null
  saveAccount(a: A | null): Promise<void>
  json: boolean
  flags: Flags
  page: number          // --page, по умолчанию 1
  limit: number         // --limit, по умолчанию 10
  prompt(q: string): Promise<string>
  secret(q: string): Promise<string>
  warn(msg: string): void  // stderr
}
type CommandResult = { json: unknown; render?: () => string }
type ProviderCommand<A> = { usage: string; about: string; auth: boolean; run(ctx: Ctx<A>, args: string[]): Promise<CommandResult> }
type BasketOps<A> = {
  list(ctx): Promise<Basket>; add(ctx, ref: Record<string, unknown>, qty: number): Promise<Basket>
  set(ctx, itemId: string, qty: number): Promise<Basket>; remove(ctx, itemId: string): Promise<Basket>
}
defineProvider<A, const C extends readonly Capability[]>(spec): ProviderSpec<A>
runProvider(spec: ProviderSpec<A>, argv = process.argv.slice(2)): Promise<never>
```

- [ ] **Step 1: Фиктивный провайдер для тестов**

`test/fixtures/fake-provider.ts`:

```ts
// Провайдер-заглушка: без сети, всё в памяти. Гоняется как отдельный процесс.
import { ProviderError, defineProvider, runProvider } from "../../src/sdk/index.ts"
import type { Basket, Offer } from "../../src/sdk/contract.ts"

type Account = { token: string; user: string }

const offer: Offer = { article: "N1", brand: "VAG", name: "Болт", price: 407, currency: "RUB", quantity: 3, deliveryDays: 2, ref: { priceId: 7 } }
let basket: Basket = { items: [], currency: "RUB" }

export const fake = defineProvider<Account, ["reviews", "garage", "basket"]>({
	id: "fake", name: "Fake", site: "https://fake.example",
	capabilities: ["reviews", "garage", "basket"],
	valueFlags: ["echo"],

	login: async ctx => {
		const user = await ctx.prompt("Логин > ")
		const password = await ctx.secret("Пароль > ")
		if (password !== "pw") throw new ProviderError("auth", "Логин или пароль не подошли")
		return { account: { token: "t-" + user, user }, display: { name: user } }
	},
	whoami: async ctx => (ctx.account ? { name: ctx.account.user } : null),
	search: async (_ctx, text) => ({ items: text === "болт" ? [{ article: "N1", brand: "VAG", name: "Болт", price: 407 }] : [], total: 1 }),
	brands: async (_ctx, article) => {
		if (article === "AMB") throw new ProviderError("ambiguous", "уточни бренд", [{ brand: "A", article }, { brand: "B", article }])
		return { items: article === "N1" ? [{ brand: "VAG", article, name: "Болт" }] : [] }
	},
	offers: async (ctx, article, brand, { analogs }) => {
		if (!ctx.account) throw new ProviderError("auth", "нужен вход")
		if (article !== "N1" || brand !== "VAG") return { items: [] }
		return { items: analogs ? [offer, { ...offer, article: "X2", analog: true }] : [offer] }
	},
	reviews: async () => ({ total: 1, items: [{ text: "ок", rating: 5 }] }),
	garageExport: async () => ({ cars: [{ brand: "SKODA", model: "OCTAVIA", ref: { carId: 1 } }] }),
	basket: {
		list: async () => basket,
		add: async (_ctx, ref, qty) => {
			basket = { ...basket, items: [...basket.items, { id: String(ref.priceId), article: "N1", brand: "VAG", price: 407, quantity: qty }] }
			return basket
		},
		set: async (_ctx, id, qty) => { basket = { ...basket, items: basket.items.map(i => (i.id === id ? { ...i, quantity: qty } : i)) }; return basket },
		remove: async (_ctx, id) => { basket = { ...basket, items: basket.items.filter(i => i.id !== id) }; return basket },
	},
	commands: {
		echo: { usage: "echo <текст> [--echo <x>]", about: "печатает аргументы", auth: false,
			run: async (ctx, args) => ({ json: { args, echo: ctx.flags.echo ?? null }, render: () => `echo: ${args.join(" ")}` }) },
		boom: { usage: "boom", about: "падает", auth: false, run: async () => { throw new Error("взрыв") } },
	},
})

if (import.meta.main) await runProvider(fake)
```

- [ ] **Step 2: Тест через subprocess**

`test/sdk/run.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { accountStore } from "../../src/sdk/account.ts"

const BIN = join(import.meta.dir, "..", "fixtures", "fake-provider.ts")
let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-run-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

async function run(args: string[]) {
	const proc = Bun.spawn(["bun", BIN, ...args], {
		env: { ...process.env, [CONFIG_DIR_ENV]: dir, NO_COLOR: "1" },
		stdin: "ignore", stdout: "pipe", stderr: "pipe",
	})
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
	const code = await proc.exited
	return { code, out, err, json: () => JSON.parse(out) }
}

describe("runProvider", () => {
	test("describe собирается из объявления", async () => {
		const r = await run(["describe", "--json"])
		expect(r.code).toBe(0)
		const d = r.json()
		expect(d.contract).toBe(1)
		expect(d.id).toBe("fake")
		expect(d.capabilities).toEqual(["reviews", "garage", "basket"])
		const names = d.commands.map((c: { name: string }) => c.name)
		expect(names).toEqual(expect.arrayContaining(["login", "whoami", "search", "brands", "offers", "reviews", "garage export", "basket", "basket add", "echo"]))
		expect(d.commands.find((c: { name: string }) => c.name === "echo").usage).toBe("echo <текст> [--echo <x>]")
	})

	test("--json печатает ровно один объект и ничего больше", async () => {
		const r = await run(["brands", "N1", "--json"])
		expect(r.code).toBe(0)
		expect(r.out.trim().split("\n")).toHaveLength(1)
		expect(r.json()).toEqual({ items: [{ brand: "VAG", article: "N1", name: "Болт" }] })
	})

	test("без --json — таблица", async () => {
		const r = await run(["brands", "N1"])
		expect(r.code).toBe(0)
		expect(r.out).toContain("БРЕНД")
		expect(r.out).toContain("VAG")
	})

	test("пустой результат — exit 0", async () => {
		const r = await run(["brands", "ZZZ", "--json"])
		expect(r.code).toBe(0)
		expect(r.json()).toEqual({ items: [] })
	})

	test("ambiguous — exit 2 с items", async () => {
		const r = await run(["brands", "AMB", "--json"])
		expect(r.code).toBe(2)
		expect(r.json().error.code).toBe("ambiguous")
		expect(r.json().error.items).toHaveLength(2)
	})

	test("offers без --brand — bad_args", async () => {
		const r = await run(["offers", "N1", "--json"])
		expect(r.code).toBe(1)
		expect(r.json().error.code).toBe("bad_args")
	})

	test("offers без аккаунта — auth; с аккаунтом — предложения; --analogs добавляет аналог", async () => {
		let r = await run(["offers", "N1", "--brand", "VAG", "--json"])
		expect(r.json().error.code).toBe("auth")
		await accountStore("fake").save({ token: "t", user: "u" })
		r = await run(["offers", "N1", "--brand", "VAG", "--json"])
		expect(r.code).toBe(0)
		expect(r.json().items).toHaveLength(1)
		r = await run(["offers", "N1", "--brand", "VAG", "--analogs", "--json"])
		expect(r.json().items).toHaveLength(2)
	})

	test("login без tty — tty", async () => {
		const r = await run(["login", "--json"])
		expect(r.code).toBe(1)
		expect(r.json().error.code).toBe("tty")
	})

	test("whoami: ok=false без аккаунта, ok=true с ним", async () => {
		expect((await run(["whoami", "--json"])).json()).toEqual({ ok: false })
		await accountStore("fake").save({ token: "t", user: "pavel" })
		expect((await run(["whoami", "--json"])).json()).toEqual({ ok: true, display: { name: "pavel" } })
	})

	test("logout удаляет файл аккаунта", async () => {
		await accountStore("fake").save({ token: "t", user: "pavel" })
		const r = await run(["logout", "--json"])
		expect(r.code).toBe(0)
		expect(await accountStore("fake").load()).toBeNull()
	})

	test("search и reviews", async () => {
		expect((await run(["search", "болт", "--json"])).json().items).toHaveLength(1)
		expect((await run(["reviews", "N1", "--brand", "VAG", "--json"])).json().total).toBe(1)
	})

	test("garage export", async () => {
		expect((await run(["garage", "export", "--json"])).json().cars[0].brand).toBe("SKODA")
	})

	test("basket add/set/rm", async () => {
		let r = await run(["basket", "add", "--ref", JSON.stringify({ priceId: 7 }), "--qty", "2", "--json"])
		expect(r.code).toBe(0)
		expect(r.json().items[0]).toMatchObject({ id: "7", quantity: 2 })
		r = await run(["basket", "add", "--ref", "{bad", "--json"])
		expect(r.json().error.code).toBe("bad_args")
		r = await run(["basket", "set", "7", "--json"])
		expect(r.json().error.code).toBe("bad_args")
	})

	test("своя команда: json и рендер, флаг со значением", async () => {
		let r = await run(["echo", "a", "b", "--echo", "x", "--json"])
		expect(r.json()).toEqual({ args: ["a", "b"], echo: "x" })
		r = await run(["echo", "a"])
		expect(r.out.trim()).toBe("echo: a")
	})

	test("чужая ошибка — internal с текстом", async () => {
		const r = await run(["boom", "--json"])
		expect(r.code).toBe(1)
		expect(r.json().error).toEqual({ code: "internal", message: "взрыв" })
	})

	test("неизвестная команда — bad_args; без --json текст в stderr", async () => {
		const r = await run(["nope"])
		expect(r.code).toBe(1)
		expect(r.out).toBe("")
		expect(r.err).toContain("неизвестная команда")
	})

	test("--help печатает usage со своими командами", async () => {
		const r = await run(["--help"])
		expect(r.code).toBe(0)
		expect(r.out).toContain("echo <текст>")
		expect(r.out).toContain("offers <артикул> --brand")
	})
})
```

Замечание: корзина фиктивного провайдера живёт в памяти одного процесса, поэтому в тесте `basket add/set/rm` каждый вызов — новый процесс с пустой корзиной; проверяются только формы ответов и ошибок, а не накопление.

- [ ] **Step 3: Падает**

Run: `bun test test/sdk/run.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Step 4: `define.ts`**

`src/sdk/define.ts`:

```ts
// define.ts — объявление провайдера. Типы делают контракт обязательным:
// пропущенный offers или reviews при capability "reviews" — ошибка компиляции.

import type { Basket, BrandsResult, Capability, CarsResult, Display, OffersResult, Reviews, SearchResult } from "./contract.ts"
import type { Flags } from "./cli.ts"
import type { ErrorMapper } from "./errors.ts"

export type Ctx<A> = {
	account: A | null
	saveAccount(a: A | null): Promise<void>
	json: boolean
	flags: Flags
	page: number
	limit: number
	prompt(q: string): Promise<string>
	secret(q: string): Promise<string>
	warn(msg: string): void
}

export type CommandResult = { json: unknown; render?: () => string }

export type ProviderCommand<A> = {
	usage: string
	about: string
	auth: boolean
	run(ctx: Ctx<A>, args: string[]): Promise<CommandResult>
}

export type BasketOps<A> = {
	list(ctx: Ctx<A>): Promise<Basket>
	add(ctx: Ctx<A>, ref: Record<string, unknown>, qty: number): Promise<Basket>
	set(ctx: Ctx<A>, itemId: string, qty: number): Promise<Basket>
	remove(ctx: Ctx<A>, itemId: string): Promise<Basket>
}

export type ProviderBase<A> = {
	id: string
	name: string
	site: string
	/** Флаги своих команд, которые принимают значение (контрактные добавляются сами). */
	valueFlags?: string[]
	mapError?: ErrorMapper

	login(ctx: Ctx<A>): Promise<{ account: A; display: Display }>
	whoami(ctx: Ctx<A>): Promise<Display | null>
	search(ctx: Ctx<A>, text: string): Promise<SearchResult>
	brands(ctx: Ctx<A>, article: string): Promise<BrandsResult>
	offers(ctx: Ctx<A>, article: string, brand: string, opts: { analogs: boolean }): Promise<OffersResult>

	reviews?(ctx: Ctx<A>, article: string, brand: string): Promise<Reviews>
	garageExport?(ctx: Ctx<A>): Promise<CarsResult>
	basket?: BasketOps<A>
	commands?: Record<string, ProviderCommand<A>>
}

type Requires<A, C extends Capability> =
	("reviews" extends C ? { reviews: NonNullable<ProviderBase<A>["reviews"]> } : {}) &
	("garage" extends C ? { garageExport: NonNullable<ProviderBase<A>["garageExport"]> } : {}) &
	("basket" extends C ? { basket: BasketOps<A> } : {})

export type ProviderSpec<A> = ProviderBase<A> & { capabilities: Capability[] }

export function defineProvider<A, const C extends readonly Capability[]>(
	spec: ProviderBase<A> & { capabilities: C } & Requires<A, C[number]>,
): ProviderSpec<A> {
	// Проверка и в рантайме — для провайдера, собранного без typecheck
	for (const cap of spec.capabilities) {
		const has = cap === "reviews" ? !!spec.reviews : cap === "garage" ? !!spec.garageExport : cap === "basket" ? !!spec.basket : true
		if (!has) throw new Error(`провайдер ${spec.id} объявил capability ${cap}, но не реализовал её`)
	}
	return { ...spec, capabilities: [...spec.capabilities] }
}
```

Если `Requires` через `"reviews" extends C` не даёт ошибки на пропущенном методе (TypeScript иногда сводит `{}`-пересечение к необязательному), заменить на явную проверку: `& (C[number] extends never ? {} : {})` не поможет — вместо этого объявить `Requires` через `Extract`: `Extract<C, "reviews"> extends never ? {} : { reviews: … }`. Тест-ориентир: `defineProvider<A, ["reviews"]>({...без reviews})` должен не компилироваться; проверить `bun run typecheck` на временном файле и удалить его.

- [ ] **Step 5: `run.ts`**

`src/sdk/run.ts`:

```ts
// run.ts — из объявления провайдера делает CLI: argv → команда → JSON или
// рендер → exit-код. С --json в stdout ровно один объект.

import { accountStore } from "./account.ts"
import { hasTTY, parseArgv, readLine, readSecret } from "./cli.ts"
import { CONTRACT_VERSION, type Command, type Describe } from "./contract.ts"
import type { Ctx, ProviderSpec } from "./define.ts"
import { ProviderError, errorBody, exitCode, toProviderError } from "./errors.ts"
import { bold, dim, fields, red, renderBasket, renderBrands, renderCars, renderDisplay, renderOffers, renderProducts, renderReviews } from "./render.ts"
import { TOOL } from "./config.ts"

const CONTRACT_VALUE_FLAGS = ["brand", "page", "limit", "qty", "ref"]

function num(name: string, v: string | true | undefined, def: number): number {
	if (v === undefined) return def
	if (v === true || v === "") throw new ProviderError("bad_args", `--${name}: нужно значение`)
	const n = Number(v)
	if (!Number.isFinite(n) || n < 0) throw new ProviderError("bad_args", `--${name}: нужно неотрицательное число, а не «${v}»`)
	return n
}

function contractCommands<A>(spec: ProviderSpec<A>): Command[] {
	const c: Command[] = [
		{ name: "describe", usage: "describe", about: "что умеет провайдер", auth: false },
		{ name: "login", usage: "login", about: "войти (диалог в терминале)", auth: false },
		{ name: "logout", usage: "logout", about: "забыть аккаунт", auth: false },
		{ name: "whoami", usage: "whoami", about: "кто авторизован", auth: false },
		{ name: "search", usage: "search <текст> [--page <n>] [--limit <n>]", about: "поиск по названию", auth: false },
		{ name: "brands", usage: "brands <артикул>", about: "кто выпускает артикул", auth: false },
		{ name: "offers", usage: "offers <артикул> --brand <имя> [--analogs]", about: "предложения: цена, наличие, срок", auth: false },
	]
	if (spec.reviews) c.push({ name: "reviews", usage: "reviews <артикул> --brand <имя> [--page <n>] [--limit <n>]", about: "оценки и отзывы", auth: false })
	if (spec.garageExport) c.push({ name: "garage export", usage: "garage export", about: "машины из гаража сайта", auth: true })
	if (spec.basket) c.push(
		{ name: "basket", usage: "basket", about: "корзина", auth: true },
		{ name: "basket add", usage: "basket add --ref <json> [--qty <n>]", about: "положить предложение (ref из offers)", auth: true },
		{ name: "basket set", usage: "basket set <itemId> --qty <n>", about: "изменить количество", auth: true },
		{ name: "basket rm", usage: "basket rm <itemId>", about: "убрать позицию", auth: true },
	)
	for (const [name, cmd] of Object.entries(spec.commands ?? {})) c.push({ name, usage: cmd.usage, about: cmd.about, auth: cmd.auth })
	return c
}

function describe<A>(spec: ProviderSpec<A>): Describe {
	return { contract: CONTRACT_VERSION, id: spec.id, name: spec.name, site: spec.site, capabilities: spec.capabilities, commands: contractCommands(spec) }
}

function usage<A>(spec: ProviderSpec<A>): string {
	const cmds = contractCommands(spec)
	const w = Math.max(...cmds.map(c => c.usage.length))
	return [
		`${bold(`${TOOL}-${spec.id}`)} — ${spec.name}, ${spec.site}`,
		"",
		...cmds.map(c => `  ${c.usage.padEnd(w)}  ${c.about}${c.auth ? dim("  (нужен вход)") : ""}`),
		"",
		dim("  --json — один JSON-объект в stdout вместо таблиц"),
	].join("\n")
}

function parseRef(v: string | true | undefined): Record<string, unknown> {
	if (typeof v !== "string" || !v) throw new ProviderError("bad_args", "нужен --ref <json> из выдачи offers")
	try {
		const o = JSON.parse(v) as unknown
		if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error()
		return o as Record<string, unknown>
	} catch {
		throw new ProviderError("bad_args", "--ref должен быть JSON-объектом")
	}
}

type Out = { json: unknown; render: () => string }

async function dispatch<A>(spec: ProviderSpec<A>, ctx: Ctx<A>, args: string[]): Promise<Out> {
	const [cmd, ...rest] = args
	const need = (v: string | undefined, what: string): string => {
		if (!v) throw new ProviderError("bad_args", `нужен ${what}`)
		return v
	}
	const brandFlag = (): string => {
		const b = ctx.flags.brand
		if (typeof b !== "string" || !b) throw new ProviderError("bad_args", "нужен --brand <имя>")
		return b
	}

	switch (cmd) {
		case "describe": {
			const d = describe(spec)
			return { json: d, render: () => fields([["id", d.id], ["сайт", d.site], ["контракт", String(d.contract)], ["умеет", d.capabilities.join(", ") || "—"]]) }
		}
		case "login": {
			if (!hasTTY()) throw new ProviderError("tty", "login нужен терминал: запусти без пайпа")
			const r = await spec.login(ctx)
			await ctx.saveAccount(r.account)
			return { json: { account: r.account, display: r.display }, render: () => renderDisplay(r.display) }
		}
		case "logout": {
			const had = ctx.account !== null
			await ctx.saveAccount(null)
			return { json: { ok: true, had }, render: () => (had ? "аккаунт удалён" : dim("аккаунта и не было")) }
		}
		case "whoami": {
			const d = ctx.account ? await spec.whoami(ctx) : null
			return { json: d ? { ok: true, display: d } : { ok: false }, render: () => renderDisplay(d) }
		}
		case "search": {
			const r = await spec.search(ctx, need(rest.join(" ") || undefined, "текст запроса"))
			return { json: r, render: () => renderProducts(r.items) }
		}
		case "brands": {
			const r = await spec.brands(ctx, need(rest[0], "артикул"))
			return { json: r, render: () => renderBrands(r.items) }
		}
		case "offers": {
			const r = await spec.offers(ctx, need(rest[0], "артикул"), brandFlag(), { analogs: ctx.flags.analogs === true })
			return { json: r, render: () => renderOffers(r.items) }
		}
		case "reviews": {
			if (!spec.reviews) break
			const r = await spec.reviews(ctx, need(rest[0], "артикул"), brandFlag())
			return { json: r, render: () => renderReviews(r) }
		}
		case "garage": {
			if (rest[0] === "export" && spec.garageExport) {
				const r = await spec.garageExport(ctx)
				return { json: r, render: () => renderCars(r.cars) }
			}
			break
		}
		case "basket": {
			if (!spec.basket) break
			const b = spec.basket
			const sub = rest[0]
			let r
			if (sub === undefined) r = await b.list(ctx)
			else if (sub === "add") r = await b.add(ctx, parseRef(ctx.flags.ref), num("qty", ctx.flags.qty, 1))
			else if (sub === "set") {
				if (ctx.flags.qty === undefined) throw new ProviderError("bad_args", "нужен --qty <n>")
				r = await b.set(ctx, need(rest[1], "itemId"), num("qty", ctx.flags.qty, 1))
			}
			else if (sub === "rm") r = await b.remove(ctx, need(rest[1], "itemId"))
			else throw new ProviderError("bad_args", `неизвестная подкоманда корзины: ${sub}`)
			return { json: r, render: () => renderBasket(r) }
		}
	}

	// Своя команда провайдера (сюда же попадают reviews/garage/basket без capability)
	const own = cmd ? spec.commands?.[cmd] : undefined
	if (!own) throw new ProviderError("bad_args", `неизвестная команда: ${cmd ?? "(пусто)"}`)
	const r = await own.run(ctx, rest)
	return { json: r.json, render: r.render ?? (() => JSON.stringify(r.json, null, 2)) }
}

export async function runProvider<A>(spec: ProviderSpec<A>, argv: string[] = process.argv.slice(2)): Promise<never> {
	const { args, flags } = parseArgv(argv, [...CONTRACT_VALUE_FLAGS, ...(spec.valueFlags ?? [])])
	const json = flags.json === true

	if (!args.length || flags.help) {
		console.log(usage(spec))
		process.exit(0)
	}

	const store = accountStore<A>(spec.id)
	const ctx: Ctx<A> = {
		account: await store.load(),
		saveAccount: async a => {
			if (a === null) await store.clear()
			else await store.save(a)
			ctx.account = a
		},
		json,
		flags,
		page: 1,
		limit: 10,
		prompt: readLine,
		secret: readSecret,
		warn: m => process.stderr.write(`${m}\n`),
	}

	try {
		ctx.page = num("page", flags.page, 1)
		ctx.limit = num("limit", flags.limit, 10)
		const out = await dispatch(spec, ctx, args)
		if (json) process.stdout.write(JSON.stringify(out.json) + "\n")
		else console.log(out.render())
		process.exit(0)
	} catch (e) {
		const pe = toProviderError(e, spec.mapError)
		if (json) process.stdout.write(JSON.stringify(errorBody(pe)) + "\n")
		else {
			process.stderr.write(red(pe.message) + "\n")
			if (pe.items?.length) process.stderr.write(renderBrands(pe.items) + "\n")
		}
		process.exit(exitCode(pe.code))
	}
}
```

- [ ] **Step 6: `index.ts`**

`src/sdk/index.ts`:

```ts
// Публичная поверхность SDK для провайдеров.
export { defineProvider } from "./define.ts"
export type { BasketOps, CommandResult, Ctx, ProviderCommand, ProviderSpec } from "./define.ts"
export { runProvider } from "./run.ts"
export { ProviderError } from "./errors.ts"
export type { ErrorMapper } from "./errors.ts"
export { HttpError, fetchJson } from "./http.ts"
export { articleKey, brandKey } from "./keys.ts"
export { accountStore } from "./account.ts"
export { CONFIG_DIR_ENV, TOOL, configDir } from "./config.ts"
export * from "./contract.ts"
export * as render from "./render.ts"
```

- [ ] **Step 7: Зелёные**

Run: `bun test test/sdk/run.test.ts && bun run typecheck`
Expected: PASS все.

- [ ] **Step 8: Commit**

```bash
git add src/sdk/define.ts src/sdk/run.ts src/sdk/index.ts test/fixtures/fake-provider.ts test/sdk/run.test.ts
git commit -m "feat(sdk): defineProvider and runProvider — contract CLI from a provider object"
```

---

### Task 9: Autodoc: перенос api/auth, хранение через accountStore, миграция token.json

**Files:**
- Move: `src/api.ts` → `src/providers/autodoc/api.ts`
- Move: `src/auth.ts` → `src/providers/autodoc/auth.ts`
- Modify: `src/main.ts` (импорты, `auth.TOKEN_PATH` → `auth.accountPath()`)
- Test: `test/providers/autodoc/auth.test.ts`

**Interfaces:**
- Consumes: `accountStore`, `configDir`.
- Produces (сигнатуры для `api.ts` и `main.ts` не меняются): `loadTokens()`, `saveTokens(t)`, `clearTokens()`, `currentToken()`, `passwordGrant`, `refresh`, `decodeClaims`, `parsePasted`, `Tokens`, `Claims`. Новое: `migrateLegacyToken(): Promise<boolean>`, `ACCOUNT_ID = "autodoc"`, `accountPath()`.

- [ ] **Step 1: Перенос файлов**

```bash
git mv src/api.ts src/providers/autodoc/api.ts
git mv src/auth.ts src/providers/autodoc/auth.ts
sed -i '' 's#from "./api.ts"#from "./providers/autodoc/api.ts"#; s#from "./auth.ts"#from "./providers/autodoc/auth.ts"#' src/main.ts
bun run typecheck
```

Expected: чисто.

- [ ] **Step 2: Тест миграции и хранения**

`test/providers/autodoc/auth.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../../src/sdk/config.ts"
import { clearTokens, loadTokens, migrateLegacyToken, parsePasted, saveTokens } from "../../../src/providers/autodoc/auth.ts"

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-auth-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

const tokens = { access_token: "a.b.c", refresh_token: "r", expires_at: 1 }

describe("хранение", () => {
	test("save/load/clear через accounts/autodoc.json", async () => {
		expect(await loadTokens()).toBeNull()
		await saveTokens(tokens)
		expect(await Bun.file(join(dir, "accounts", "autodoc.json")).exists()).toBe(true)
		expect(await loadTokens()).toEqual(tokens)
		await clearTokens()
		expect(await loadTokens()).toBeNull()
	})
})

describe("migrateLegacyToken", () => {
	test("переносит token.json, если нового файла нет", async () => {
		await writeFile(join(dir, "token.json"), JSON.stringify(tokens))
		expect(await migrateLegacyToken()).toBe(true)
		expect(await loadTokens()).toEqual(tokens)
		expect(await Bun.file(join(dir, "token.json")).exists()).toBe(false)
	})
	test("не трогает новый файл, если он уже есть", async () => {
		await saveTokens({ ...tokens, access_token: "new" })
		await writeFile(join(dir, "token.json"), JSON.stringify(tokens))
		expect(await migrateLegacyToken()).toBe(false)
		expect((await loadTokens())!.access_token).toBe("new")
	})
	test("нечего переносить — false", async () => {
		expect(await migrateLegacyToken()).toBe(false)
	})
})

describe("parsePasted", () => {
	test("достаёт токены из дампа sessionStorage", () => {
		const dump = JSON.stringify({ authnResult: JSON.stringify({ access_token: "x.y.z", refresh_token: "r", expires_in: 100 }) })
		const p = parsePasted(dump)
		expect(p && "tokens" in p ? p.tokens.access_token : null).toBe("x.y.z")
	})
	test("диагностика SPA распознаётся", () => {
		expect(parsePasted('{"authDiagSnapshot":"could not find matching config for state abc"}')).toEqual({ diag: "abc" })
	})
})
```

- [ ] **Step 3: Падает**

Run: `bun test test/providers/autodoc/auth.test.ts`
Expected: FAIL: `migrateLegacyToken` не экспортирован; `loadTokens` читает старый путь.

- [ ] **Step 4: Правка `auth.ts`**

Заменить блок от `const configHome = …` до конца `clearTokens` на:

```ts
import { accountStore } from "../../sdk/account.ts"
import { configDir } from "../../sdk/config.ts"

export const ACCOUNT_ID = "autodoc"
const store = () => accountStore<Tokens>(ACCOUNT_ID)
export const accountPath = () => store().path

export const loadTokens = (): Promise<Tokens | null> => store().load()
export const saveTokens = (t: Tokens): Promise<void> => store().save(t)
export const clearTokens = (): Promise<void> => store().clear()

/**
 * До версии 2 токен лежал в <config>/token.json. Переносим в accounts/autodoc.json,
 * если нового файла ещё нет; старый удаляем, чтобы refresh-токен не жил в двух местах.
 */
export async function migrateLegacyToken(): Promise<boolean> {
	const legacy = join(configDir(), "token.json")
	if (await store().load()) return false
	let t: Tokens
	try {
		t = JSON.parse(await readFile(legacy, "utf8")) as Tokens
	} catch {
		return false
	}
	await saveTokens(t)
	try { await unlink(legacy) } catch { /* уже нет */ }
	return true
}
```

Импорты `mkdir, chmod, writeFile, dirname, homedir` из `auth.ts` удалить; `readFile`, `unlink`, `join` остаются. Удалить `export const TOKEN_PATH`; в `src/main.ts` заменить `auth.TOKEN_PATH` на `auth.accountPath()` (два места: `accountFields` и `logout`).

- [ ] **Step 5: Зелёные**

Run: `bun test test/providers/autodoc/auth.test.ts && bun run typecheck`
Expected: тесты PASS. `bun src/main.ts whoami` на этом шаге скажет «не авторизован»: старый `main.ts` миграцию не зовёт, файл переедет в Task 13 при первом запуске нового бинаря.

- [ ] **Step 6: Commit**

```bash
git add -A src/providers/autodoc src/main.ts test/providers/autodoc/auth.test.ts
git commit -m "refactor(autodoc): move api/auth under providers, store tokens via accountStore, migrate token.json"
```

---

### Task 10: Autodoc: маппинг сырых ответов в типы контракта

**Files:**
- Create: `src/providers/autodoc/map.ts`
- Create: `test/fixtures/autodoc/manufacturers.json`, `goods-info.json`, `originals.json`, `reviews.json`, `suggest.json`, `find-goods.json`, `garage-cars.json`, `basket-items.json`
- Test: `test/providers/autodoc/map.test.ts`

**Interfaces:**
- Consumes: типы из `api.ts` (`SearchHit`, `GoodsInfo`, `Reviews as ApiReviews`, `Suggestion`, `CatalogGood`, `Car as ApiCar`) и контракт.
- Produces:

```ts
type Originals = { items: { id: string; title: string; goods: OriginalsGood[] }[] }
type OriginalsGood = { article; displayArticle?; name; manufacturer: { id; name }; minimalPrice?; minimalDeliveryDays?; imageUrl?; rating?: { average; quantity }; isOriginal?; items: OriginalsItem[] }
type OriginalsItem = { id: number; price; quantity?; deliveryDays?; deliveryDate?; supplier?: { name?; description? }; partnerId?; priceType?; directionToManufacturerId?; minimalQuantity?; hash? }
type AutodocRef = { priceId; partnerId?; directionToManufacturerId?; article; partName; priceType?; price; deliveryDays?; minimalQuantity; hash?; manufacturerId }
type RawBasket = { total?: number; items?: RawBasketItem[] }
type RawBasketItem = Record<string, unknown> & { id: number | string; quantity: number; price: number; priceType?: number; hash?: string }

toRating(r?): Rating | undefined
toBrandHits(hits: SearchHit[], infos: Map<number, GoodsInfo | null>): BrandHit[]
toOffers(r: Originals, article: string, brand: string, forceAnalog?: boolean): Offer[]
toProducts(goods: CatalogGood[], category?: string): Product[]
categoryIds(s: Suggestion[]): { id: number; title: string }[]
toReviews(r: ApiReviews, info: GoodsInfo | null): Reviews
toCars(cars: ApiCar[], mainId?: number | null): Car[]
toBasket(raw: RawBasket): Basket
basketAddBody(ref: AutodocRef, qty: number): Record<string, unknown>
```

- [ ] **Step 1: Фикстуры**

Обрезаны до 1–2 элементов, VIN и clientCode заменены на `XXX`. Источники: `docs/autodoc-api.md` и реальный ответ `price-list/originals` (2026-09-01). `basket-items.json` — форма из фронта; реальную записать в Task 13.

`test/fixtures/autodoc/manufacturers.json`:
```json
{"items":[{"article":"N90954802","manufacturer":{"name":"VAG","id":657},"goodsName":"Болт","imageUrl":"https://images.autodoc.ru/goods/657/N90954802/med.webp"}]}
```

`test/fixtures/autodoc/goods-info.json`:
```json
{"article":"N90954802","name":"Болт","categoryId":4558,"isFavorite":false,"manufacturer":{"id":657,"name":"VAG"},"rating":{"average":4.9107,"quantity":56,"ratings":[54,1,0,0,1]},"imageUrls":["https://images.autodoc.ru/goods/657/N90954802/1.webp"],"inStock":4}
```

`test/fixtures/autodoc/originals.json`:
```json
{"items":[
 {"id":"5","title":"Рекомендованные партнёрами аналоги","goods":[
  {"article":"2098001pcs2","displayArticle":"2098-001-PCS2","name":"Болты","manufacturer":{"name":"FEBEST","id":5216},"minimalPrice":916,"minimalDeliveryDays":2,"imageUrl":"https://images.autodoc.ru/goods/5216/2098001pcs2/m.webp","rating":{"average":4.8,"quantity":4},"isOriginal":true,
   "items":[{"price":916,"quantity":60,"deliveryDays":2,"deliveryDate":"2026-09-04T00:00:00","supplier":{"name":"Дистрибьютор","description":"Склад дистрибьютора"},"directionToManufacturerId":1,"minimalQuantity":1,"partnerId":2,"priceType":2,"hash":"H1","id":101}]}]},
 {"id":"6","title":"Все предложения N90954802","goods":[
  {"article":"n90954802","displayArticle":"N 909 548 02","name":"Болт","manufacturer":{"name":"VAG","id":657},"minimalPrice":407,"minimalDeliveryDays":1,"imageUrl":"https://images.autodoc.ru/goods/657/n90954802/m.webp","rating":{"average":4.9,"quantity":56},"isOriginal":true,
   "items":[
    {"price":407,"quantity":100,"deliveryDays":3,"deliveryDate":"2026-09-07T00:00:00","supplier":{"name":"Дилер","description":"Склад дилера"},"directionToManufacturerId":544130,"minimalQuantity":1,"partnerId":6727,"priceType":2,"hash":"H2","id":2670855866},
    {"price":428,"quantity":20,"deliveryDays":2,"deliveryDate":"2026-09-04T00:00:00","supplier":{"name":"MEX","description":"Оптовый склад"},"directionToManufacturerId":544130,"minimalQuantity":1,"partnerId":6727,"priceType":2,"hash":"H3","id":2670855867}]}]}
]}
```

`test/fixtures/autodoc/reviews.json`:
```json
{"summary":{"name":"Нейросеть YandexGPT","pros":["Как оригинал.","Отличное качество."],"cons":["Изогнулся при установке."]},"sorting":[{"name":"Сначала интересные","id":1}],"totalCount":35,"items":[{"content":"хороший товар","clientName":"Юрий Л.","clientLabel":"Товар куплен в Автодок","mark":5,"createdDate":"2025-03-01T10:00:00","pros":"крепкий","cons":"","status":{"status":"Published","name":"Опубликовано"}}]}
```

`test/fixtures/autodoc/suggest.json`:
```json
{"items":[{"title":"БОЛТМАСТЕР","subtitle":"Производитель","routeUrl":"/man/9571"},{"title":"Болты","subtitle":"Инструменты и техника","routeUrl":"/catalogs/universal/goods/bolty-408"},{"title":"Болты крепёжные","subtitle":"Крепёж","routeUrl":"/catalogs/universal/goods/bolty-krepezhnye-409"}]}
```

`test/fixtures/autodoc/find-goods.json`:
```json
{"totalCount":183,"sorting":[{"name":"Сначала популярные","id":1}],"items":[{"article":"kr013511020","name":"KRANZ Болты мебельные DIN 603, 8х30, короб","manufacturer":{"id":8341,"name":"KRANZ"},"price":252,"quantity":7,"rating":{"average":0,"quantity":0},"isFavorite":false}]}
```

`test/fixtures/autodoc/garage-cars.json`:
```json
{"cars":[{"id":10,"brand":"SKODA","brandId":575,"model":"OCTAVIA III лифтбек (5E3)","modelId":11195,"modificationId":58759,"engine":"1.8 TSI","year":2017,"vin":"XXX","odometer":0,"fullName":"SKODA OCTAVIA III лифтбек (5E3)","clientCode":"XXX","activeRequestsCount":0}],"totalActiveRequestsCount":0}
```

`test/fixtures/autodoc/basket-items.json`:
```json
{"total":814,"items":[{"id":555,"article":"N90954802","displayArticle":"N 909 548 02","name":"Болт","manufacturer":{"id":657,"name":"VAG"},"price":407,"quantity":2,"total":814,"deliveryDays":3,"priceType":2,"hash":"H2","description":""}]}
```

- [ ] **Step 2: Тест**

`test/providers/autodoc/map.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { basketAddBody, categoryIds, toBasket, toBrandHits, toCars, toOffers, toProducts, toReviews } from "../../../src/providers/autodoc/map.ts"

const fx = async (n: string) => JSON.parse(await Bun.file(`${import.meta.dir}/../../fixtures/autodoc/${n}.json`).text())

describe("toBrandHits", () => {
	test("производитель + рейтинг из info", async () => {
		const hits = toBrandHits((await fx("manufacturers")).items, new Map([[657, await fx("goods-info")]]))
		expect(hits).toEqual([{ brand: "VAG", article: "N90954802", name: "Болт", rating: { average: 4.9107, count: 56 },
			images: ["https://images.autodoc.ru/goods/657/N90954802/med.webp"], extra: { manufacturerId: 657 } }])
	})
})

describe("toOffers", () => {
	test("точные предложения и аналоги, ref для корзины", async () => {
		const offers = toOffers(await fx("originals"), "n90954802", "VAG")
		expect(offers).toHaveLength(3)
		const exact = offers.filter(o => !o.analog)
		expect(exact).toHaveLength(2)
		expect(exact[0]).toMatchObject({
			article: "N 909 548 02", brand: "VAG", name: "Болт", price: 407, currency: "RUB", quantity: 100,
			deliveryDays: 3, deliveryDate: "2026-09-07", seller: "Дилер · Склад дилера",
			rating: { average: 4.9, count: 56 }, url: "https://www.autodoc.ru/price/657/n90954802",
			ref: { priceId: 2670855866, partnerId: 6727, directionToManufacturerId: 544130, article: "n90954802", partName: "Болт",
				priceType: 2, price: 407, deliveryDays: 3, minimalQuantity: 1, hash: "H2", manufacturerId: 657 },
		})
		const analog = offers.find(o => o.analog)!
		expect(analog.brand).toBe("FEBEST")
		expect(analog.analogOf).toEqual({ article: "n90954802", brand: "VAG" })
	})
	test("forceAnalog помечает всё аналогом", async () => {
		expect(toOffers(await fx("originals"), "n90954802", "VAG", true).every(o => o.analog)).toBe(true)
	})
})

describe("search по названию", () => {
	test("categoryIds берёт только категории", async () => {
		expect(categoryIds((await fx("suggest")).items)).toEqual([{ id: 408, title: "Болты" }, { id: 409, title: "Болты крепёжные" }])
	})
	test("toProducts", async () => {
		expect(toProducts((await fx("find-goods")).items, "Болты")[0]).toMatchObject({
			article: "kr013511020", brand: "KRANZ", price: 252, currency: "RUB", quantity: 7, category: "Болты",
		})
		expect(toProducts((await fx("find-goods")).items)[0]!.rating).toBeUndefined() // 0 оценок — нет рейтинга
	})
})

describe("toReviews", () => {
	test("рейтинг из info, гистограмма, выжимка, покупка подтверждена", async () => {
		const r = toReviews(await fx("reviews"), await fx("goods-info"))
		expect(r.total).toBe(35)
		expect(r.rating).toEqual({ average: 4.9107, count: 56, histogram: [54, 1, 0, 0, 1] })
		expect(r.summary).toEqual({ pros: ["Как оригинал.", "Отличное качество."], cons: ["Изогнулся при установке."] })
		expect(r.items[0]).toEqual({ author: "Юрий Л.", date: "2025-03-01", rating: 5, pros: "крепкий", cons: undefined, text: "хороший товар", purchased: true })
	})
})

describe("toCars", () => {
	test("ref с carId и modificationId", async () => {
		expect(toCars((await fx("garage-cars")).cars, 10)[0]).toEqual({
			brand: "SKODA", model: "OCTAVIA III лифтбек (5E3)", year: 2017, engine: "1.8 TSI", vin: "XXX", odometer: undefined,
			ref: { carId: 10, modificationId: 58759, main: true },
		})
	})
})

describe("basket", () => {
	test("toBasket", async () => {
		const b = toBasket(await fx("basket-items"))
		expect(b.total).toBe(814)
		expect(b.items[0]).toMatchObject({ id: "555", article: "N 909 548 02", brand: "VAG", price: 407, quantity: 2, sum: 814, deliveryDays: 3 })
		expect(b.items[0]!.extra).toMatchObject({ priceType: 2, hash: "H2" })
	})
	test("basketAddBody — форма фронта", () => {
		expect(basketAddBody({ priceId: 1, partnerId: 2, directionToManufacturerId: 3, article: "n1", partName: "Болт", priceType: 2, price: 407, deliveryDays: 3, minimalQuantity: 1, hash: "h", manufacturerId: 657 }, 2))
			.toEqual({ priceId: 1, partnerId: 2, directionToManufacturerId: 3, article: "n1", partName: "Болт", quantity: 2, price: 407, priceType: 2, description: "", deliveryDays: 3 })
	})
})
```

- [ ] **Step 3: Падает**

Run: `bun test test/providers/autodoc/map.test.ts`
Expected: FAIL.

- [ ] **Step 4: `map.ts`**

`src/providers/autodoc/map.ts`:

```ts
// map.ts — сырые ответы web.autodoc.ru → типы контракта. Формы ответов см. в
// docs/autodoc-api.md и test/fixtures/autodoc/*.json.

import type { Basket, BasketItem, BrandHit, Car, Offer, Product, Rating, Review, Reviews } from "../../sdk/contract.ts"
import { articleKey, brandKey } from "../../sdk/keys.ts"
import { isoDate } from "../../sdk/render.ts"
import type { Car as ApiCar, CatalogGood, GoodsInfo, Reviews as ApiReviews, SearchHit, Suggestion } from "./api.ts"

export type OriginalsItem = {
	id: number; price: number; quantity?: number; deliveryDays?: number; deliveryDate?: string
	supplier?: { name?: string; description?: string }
	partnerId?: number; priceType?: number; directionToManufacturerId?: number; minimalQuantity?: number; hash?: string
}
export type OriginalsGood = {
	article: string; displayArticle?: string; name: string; manufacturer: { id: number; name: string }
	minimalPrice?: number; minimalDeliveryDays?: number; imageUrl?: string
	rating?: { average: number; quantity: number }; isOriginal?: boolean; items: OriginalsItem[]
}
export type Originals = { items: { id: string; title: string; goods: OriginalsGood[] }[] }

/** Что фронт шлёт в POST basket/items — всё берётся из строки прайса. */
export type AutodocRef = {
	priceId: number; partnerId?: number; directionToManufacturerId?: number
	article: string; partName: string; priceType?: number; price: number; deliveryDays?: number
	minimalQuantity: number; hash?: string; manufacturerId: number
}

export type RawBasketItem = Record<string, unknown> & { id: number | string; quantity: number; price: number; priceType?: number; hash?: string }
export type RawBasket = { total?: number; items?: RawBasketItem[] }

export const toRating = (r?: { average: number; quantity: number } | null): Rating | undefined =>
	r && r.quantity ? { average: r.average, count: r.quantity } : undefined

export function toBrandHits(hits: SearchHit[], infos: Map<number, GoodsInfo | null>): BrandHit[] {
	return hits.map(h => {
		const info = infos.get(h.manufacturer.id)
		return {
			brand: h.manufacturer.name, article: h.article, name: h.goodsName || info?.name,
			rating: toRating(info?.rating),
			images: h.imageUrl ? [h.imageUrl] : info?.imageUrls,
			extra: { manufacturerId: h.manufacturer.id },
		}
	})
}

export function toOffers(r: Originals, article: string, brand: string, forceAnalog = false): Offer[] {
	const wantArticle = articleKey(article)
	const wantBrand = brandKey(brand)
	const out: Offer[] = []
	for (const group of r.items ?? []) {
		for (const g of group.goods ?? []) {
			const analog = forceAnalog || articleKey(g.article) !== wantArticle || brandKey(g.manufacturer.name) !== wantBrand
			for (const it of g.items ?? []) {
				const ref: AutodocRef = {
					priceId: it.id, partnerId: it.partnerId, directionToManufacturerId: it.directionToManufacturerId,
					article: g.article, partName: g.name, priceType: it.priceType, price: it.price, deliveryDays: it.deliveryDays,
					minimalQuantity: it.minimalQuantity ?? 1, hash: it.hash, manufacturerId: g.manufacturer.id,
				}
				out.push({
					article: g.displayArticle ?? g.article, brand: g.manufacturer.name, name: g.name,
					price: it.price, currency: "RUB", quantity: it.quantity,
					deliveryDays: it.deliveryDays, deliveryDate: isoDate(it.deliveryDate),
					seller: [it.supplier?.name, it.supplier?.description].filter(Boolean).join(" · ") || undefined,
					rating: toRating(g.rating), images: g.imageUrl ? [g.imageUrl] : undefined,
					url: `https://www.autodoc.ru/price/${g.manufacturer.id}/${g.article}`,
					ref: ref as unknown as Record<string, unknown>,
					...(analog ? { analog: true, analogOf: { article, brand } } : {}),
					extra: { group: group.title, minimalQuantity: it.minimalQuantity, priceType: it.priceType },
				})
			}
		}
	}
	return out
}

/** Категории из подсказки: routeUrl вида /catalogs/universal/goods/bolty-408. Производители (/man/…) не нужны. */
export function categoryIds(s: Suggestion[]): { id: number; title: string }[] {
	const out: { id: number; title: string }[] = []
	for (const it of s) {
		const m = it.routeUrl?.match(/\/goods\/[^/]*-(\d+)$/)
		if (m) out.push({ id: Number(m[1]), title: it.title })
	}
	return out
}

export const toProducts = (goods: CatalogGood[], category?: string): Product[] =>
	goods.map(g => ({
		article: g.article, brand: g.manufacturer?.name ?? "", name: g.name,
		price: g.price, currency: "RUB", quantity: g.quantity, rating: toRating(g.rating), category,
		url: g.manufacturer ? `https://www.autodoc.ru/price/${g.manufacturer.id}/${g.article}` : undefined,
	}))

export function toReviews(r: ApiReviews, info: GoodsInfo | null): Reviews {
	const items: Review[] = (r.items ?? []).map(it => ({
		author: it.clientName, date: isoDate(it.createdDate), rating: it.mark,
		pros: it.pros || undefined, cons: it.cons || undefined, text: it.content ?? "",
		purchased: /куплен/i.test(it.clientLabel ?? ""),
	}))
	const rating = toRating(info?.rating)
	return {
		total: r.totalCount ?? items.length,
		rating: rating ? { ...rating, histogram: info?.rating?.ratings } : undefined,
		summary: r.summary ? { pros: r.summary.pros ?? [], cons: r.summary.cons ?? [] } : undefined,
		items,
	}
}

export const toCars = (cars: ApiCar[], mainId?: number | null): Car[] =>
	cars.map(c => ({
		brand: c.brand, model: c.model, year: c.year, engine: c.engine, vin: c.vin, odometer: c.odometer || undefined,
		ref: { carId: c.id, modificationId: c.modificationId, main: c.id === mainId },
	}))

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)
const numv = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined)

export function toBasket(raw: RawBasket): Basket {
	const items: BasketItem[] = (raw.items ?? []).map(it => {
		const man = it.manufacturer as { name?: string } | undefined
		return {
			id: String(it.id), article: str(it.displayArticle) ?? str(it.article) ?? "", brand: man?.name ?? str(it.manufacturerName) ?? "",
			name: str(it.name), price: it.price, quantity: it.quantity, sum: numv(it.total) ?? it.price * it.quantity,
			seller: str(it.supplierName), deliveryDays: numv(it.deliveryDays), deliveryDate: isoDate(str(it.deliveryDate)),
			extra: { priceType: it.priceType, hash: it.hash, description: it.description },
		}
	})
	return { items, total: raw.total, currency: "RUB", url: "https://www.autodoc.ru/basket" }
}

export const basketAddBody = (ref: AutodocRef, qty: number): Record<string, unknown> => ({
	priceId: ref.priceId, partnerId: ref.partnerId, directionToManufacturerId: ref.directionToManufacturerId,
	article: ref.article, partName: ref.partName, quantity: qty, price: ref.price, priceType: ref.priceType,
	description: "", deliveryDays: ref.deliveryDays,
})
```

- [ ] **Step 5: Зелёные, commit**

Run: `bun test test/providers/autodoc/map.test.ts && bun run typecheck`

```bash
git add src/providers/autodoc/map.ts test/fixtures/autodoc test/providers/autodoc/map.test.ts
git commit -m "feat(autodoc): map raw responses to contract types"
```

---

### Task 11: Autodoc: недостающие вызовы API, фикстурный режим, разрешение бренда по имени

**Files:**
- Modify: `src/providers/autodoc/api.ts`
- Modify: `src/providers/autodoc/auth.ts` (`currentToken` в фикстурном режиме)
- Create: `src/providers/autodoc/brand.ts`
- Test: `test/providers/autodoc/brand.test.ts`

**Interfaces:**
- Produces в `api.ts`: `offers`/`analogs` типизированы как `Originals`; `basket()` → `RawBasket`; новые `basketAdd(body)`, `basketUpdate(body)`, `basketDelete(body)`; фикстурный режим через `ADOC_FIXTURES`.
- Produces в `brand.ts`: `pickBrand(hits, given?)` чистая и `resolveBrand(article, given?)` сетевая, обе → `{ id: number; name: string; goodsName?: string }`.

- [ ] **Step 1: Тест `pickBrand`**

`test/providers/autodoc/brand.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { pickBrand } from "../../../src/providers/autodoc/brand.ts"
import { ProviderError } from "../../../src/sdk/errors.ts"
import type { SearchHit } from "../../../src/providers/autodoc/api.ts"

const hit = (id: number, name: string): SearchHit => ({ article: "N1", goodsName: "Болт", manufacturer: { id, name } })

describe("pickBrand", () => {
	test("один производитель — он", () => {
		expect(pickBrand([hit(657, "VAG")])).toEqual({ id: 657, name: "VAG", goodsName: "Болт" })
	})
	test("числовой id", () => {
		expect(pickBrand([hit(1, "A"), hit(2, "B")], "2").id).toBe(2)
	})
	test("имя без учёта регистра и дефисов", () => {
		expect(pickBrand([hit(1, "MANN-FILTER"), hit(2, "B")], "mann filter").id).toBe(1)
	})
	test("несколько без уточнения — ambiguous с items", () => {
		const e = (() => { try { pickBrand([hit(1, "A"), hit(2, "B")]); return null } catch (x) { return x as ProviderError } })()!
		expect(e.code).toBe("ambiguous")
		expect(e.items?.map(i => i.brand)).toEqual(["A", "B"])
	})
	test("пусто — notfound", () => {
		expect(() => pickBrand([])).toThrow(ProviderError)
	})
})
```

- [ ] **Step 2: Падает**

Run: `bun test test/providers/autodoc/brand.test.ts`

- [ ] **Step 3: `brand.ts`**

`src/providers/autodoc/brand.ts`:

```ts
// brand.ts — артикул → производитель. Один артикул бывает у нескольких
// производителей, и цены/отзывы у них разные, поэтому без уточнения — ambiguous.

import { ProviderError } from "../../sdk/errors.ts"
import { brandKey } from "../../sdk/keys.ts"
import * as api from "./api.ts"
import type { SearchHit } from "./api.ts"

export type Brand = { id: number; name: string; goodsName?: string }

export function pickBrand(hits: SearchHit[], given?: string): Brand {
	if (!hits.length) throw new ProviderError("notfound", "артикул не найден")
	const pick = (h: SearchHit): Brand => ({ id: h.manufacturer.id, name: h.manufacturer.name, goodsName: h.goodsName })
	if (given && /^\d+$/.test(given)) {
		const h = hits.find(x => x.manufacturer.id === Number(given))
		return h ? pick(h) : { id: Number(given), name: "" }
	}
	if (given) {
		const h = hits.find(x => brandKey(x.manufacturer.name) === brandKey(given))
		if (h) return pick(h)
	}
	if (hits.length === 1 && !given) return pick(hits[0]!)
	throw new ProviderError("ambiguous",
		given ? `бренда «${given}» у артикула нет — выбери из списка` : "артикул есть у нескольких производителей — уточни бренд",
		hits.map(h => ({ brand: h.manufacturer.name, article: h.article, name: h.goodsName, extra: { manufacturerId: h.manufacturer.id } })))
}

export async function resolveBrand(article: string, given?: string): Promise<Brand> {
	const { items } = await api.searchArticle(article)
	return pickBrand(items ?? [], given)
}
```

- [ ] **Step 4: Правки `api.ts`**

Заменить `offers`, `analogs`, `basket` и добавить мутации корзины:

```ts
import type { Originals, RawBasket } from "./map.ts"

export const offers = (Article: string, ManufacturerId: number) =>
	call<Originals>("GET", "/api/price-service/price-list/originals", { query: { Article, ManufacturerId, LoadAnalogs: false }, auth: true })

export const analogs = (Article: string, ManufacturerId: number) =>
	call<Originals>("GET", "/api/price-service/price-list/analogs", { query: { Article, ManufacturerId }, auth: true })

export const basket = () => call<RawBasket>("GET", "/api/basket-service/basket/items", { auth: true })
export const basketAdd = (body: Record<string, unknown>) =>
	call<unknown>("POST", "/api/basket-service/basket/items", { body, auth: true })
export const basketUpdate = (body: { id: number | string; quantity: number; description?: string; priceType?: number; hash?: string }) =>
	call<unknown>("PUT", "/api/basket-service/basket/items", { body, auth: true })
export const basketDelete = (body: { items: { id: number | string; priceType?: number; hash?: string }[]; deleteAll: false }) =>
	call<unknown>("DELETE", "/api/basket-service/basket/items", { body, auth: true })
```

Циклический импорт `api.ts` ↔ `map.ts` только типовой (`import type`), это допустимо.

Фикстурный режим — в начало `call()`, до построения URL. Имя файла: `<METHOD>_<path с _ вместо />.json`:

```ts
const fixtures = process.env.ADOC_FIXTURES
if (fixtures) {
	if (opts.auth && !(await currentToken())) throw new ApiError(401, path, "")
	const name = `${method}_${path.replace(/\//g, "_")}.json`
	const f = Bun.file(`${fixtures}/${name}`)
	if (!(await f.exists())) throw new ApiError(404, path, `нет фикстуры ${name}`)
	return JSON.parse(await f.text()) as T
}
```

В `currentToken()` из `auth.ts` — не ходить за refresh в фикстурном режиме: после проверки `expires_at` добавить `if (process.env.ADOC_FIXTURES) return null`.

- [ ] **Step 5: Зелёные, commit**

Run: `bun test test/providers/autodoc && bun run typecheck`

```bash
git add src/providers/autodoc/api.ts src/providers/autodoc/auth.ts src/providers/autodoc/brand.ts test/providers/autodoc/brand.test.ts
git commit -m "feat(autodoc): typed originals/basket calls, fixture mode, brand resolution by name"
```

---

### Task 12: Autodoc: объявление провайдера (контракт)

**Files:**
- Create: `src/providers/autodoc/provider.ts`
- Create: `src/providers/autodoc/commands.ts` (заглушка, наполняется в Task 13)
- Create: `src/providers/autodoc/main.ts`
- Create: `test/fixtures/autodoc/http/*.json`
- Test: `test/providers/autodoc/provider.test.ts`

**Interfaces:**
- Consumes: SDK, `api.ts`, `auth.ts`, `map.ts`, `brand.ts`.
- Produces: `export const autodoc: ProviderSpec<Tokens>`; `main.ts` вызывает `migrateLegacyToken()` и `runProvider(autodoc)`.

- [ ] **Step 1: HTTP-фикстуры**

Каталог `test/fixtures/autodoc/http/`, имена по правилу из Task 11. Скопировать из фикстур Task 10:

```bash
F=test/fixtures/autodoc; H=$F/http; mkdir -p $H
cp $F/manufacturers.json "$H/GET__api_price-service_search_manufacturers.json"
cp $F/goods-info.json    "$H/GET__api_goods-service_goods_info.json"
cp $F/originals.json     "$H/GET__api_price-service_price-list_originals.json"
cp $F/reviews.json       "$H/GET__api_goods-service_feedback_messages.json"
cp $F/suggest.json       "$H/POST__api_catalog-universal-service_catalog-universal-categories_search.json"
cp $F/find-goods.json    "$H/POST__api_catalog-universal-service_catalog-universal-goods_find-goods.json"
cp $F/garage-cars.json   "$H/GET__api_garage-service_garage_cars.json"
cp $F/basket-items.json  "$H/GET__api_basket-service_basket_items.json"
echo '{"minimalPrice":317,"minimalDeliveryDays":0}' > "$H/GET__api_goods-service_goods_price.json"
echo '{"car":{"id":10}}' > "$H/GET__api_garage-service_garage_top-car.json"
```

- [ ] **Step 2: Тест без сети**

`test/providers/autodoc/provider.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../../src/sdk/config.ts"
import { accountStore } from "../../../src/sdk/account.ts"

const BIN = join(import.meta.dir, "../../../src/providers/autodoc/main.ts")
const FIX = join(import.meta.dir, "../../fixtures/autodoc/http")
let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-autodoc-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

const live = () => accountStore("autodoc").save({ access_token: "a.b.c", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600 })

async function run(args: string[]) {
	const proc = Bun.spawn(["bun", BIN, ...args, "--json"], {
		env: { ...process.env, [CONFIG_DIR_ENV]: dir, ADOC_FIXTURES: FIX, NO_COLOR: "1" },
		stdin: "ignore", stdout: "pipe", stderr: "pipe",
	})
	const out = await new Response(proc.stdout).text()
	return { code: await proc.exited, json: JSON.parse(out) }
}

describe("adoc-autodoc", () => {
	test("describe", async () => {
		const r = await run(["describe"])
		expect(r.json.id).toBe("autodoc")
		expect(r.json.capabilities).toEqual(["reviews", "garage", "analogs", "basket"])
	})
	test("brands", async () => {
		const r = await run(["brands", "n90954802"])
		expect(r.json.items[0]).toMatchObject({ brand: "VAG", rating: { count: 56 } })
	})
	test("offers без входа — auth", async () => {
		expect((await run(["offers", "n90954802", "--brand", "VAG"])).json.error.code).toBe("auth")
	})
	test("offers с входом", async () => {
		await live()
		const r = await run(["offers", "n90954802", "--brand", "VAG"])
		expect(r.code).toBe(0)
		expect(r.json.items.filter((o: { analog?: boolean }) => !o.analog)).toHaveLength(2)
	})
	test("offers с неверным брендом — ambiguous", async () => {
		await live()
		expect((await run(["offers", "n90954802", "--brand", "BOSCH"])).code).toBe(2)
	})
	test("search по названию: категория → товары", async () => {
		const r = await run(["search", "болт"])
		expect(r.json.items[0].article).toBe("kr013511020")
		expect(r.json.extra.categories).toHaveLength(2)
	})
	test("reviews", async () => {
		const r = await run(["reviews", "n90954802", "--brand", "VAG"])
		expect(r.json.total).toBe(35)
		expect(r.json.rating.histogram).toEqual([54, 1, 0, 0, 1])
	})
	test("garage export", async () => {
		await live()
		const r = await run(["garage", "export"])
		expect(r.json.cars[0].ref).toEqual({ carId: 10, modificationId: 58759, main: true })
	})
	test("basket", async () => {
		await live()
		const r = await run(["basket"])
		expect(r.json.items[0]).toMatchObject({ id: "555", quantity: 2 })
	})
	test("whoami с токеном показывает маскированные поля", async () => {
		const payload = Buffer.from(JSON.stringify({ unique_name: "user1", email: "pavel@example.com", phone_number: "+79990001234" })).toString("base64url")
		await accountStore("autodoc").save({ access_token: `h.${payload}.s`, expires_at: Math.floor(Date.now() / 1000) + 3600 })
		const r = await run(["whoami"])
		expect(r.json).toEqual({ ok: true, display: { name: "user1", email: "pa•••@example.com", phone: "+7••••••1234" } })
	})
})
```

- [ ] **Step 3: Падает**

Run: `bun test test/providers/autodoc/provider.test.ts`
Expected: FAIL, нет `main.ts`.

- [ ] **Step 4: Заглушка `commands.ts`**

```ts
// commands.ts — команды autodoc сверх контракта. Наполняется в следующей задаче.
import type { ProviderCommand } from "../../sdk/define.ts"
import type { Tokens } from "./auth.ts"

export const commands: Record<string, ProviderCommand<Tokens>> = {}
```

- [ ] **Step 5: `provider.ts`**

```ts
// provider.ts — autodoc.ru как провайдер контракта. Вся сайтоспецифика — в
// api.ts/auth.ts/map.ts; здесь только склейка вызовов и свои команды.

import { ProviderError, defineProvider } from "../../sdk/index.ts"
import type { Display } from "../../sdk/contract.ts"
import { maskEmail, maskPhone } from "../../sdk/render.ts"
import * as api from "./api.ts"
import { ApiError } from "./api.ts"
import * as auth from "./auth.ts"
import type { Tokens } from "./auth.ts"
import { resolveBrand } from "./brand.ts"
import { commands } from "./commands.ts"
import { basketAddBody, categoryIds, toBasket, toBrandHits, toCars, toOffers, toProducts, toReviews, type AutodocRef } from "./map.ts"

function display(t: Tokens): Display {
	const c = auth.decodeClaims(t.access_token)
	const email = c?.displayEmail || c?.email
	return {
		name: c?.unique_name || c?.login || c?.preferred_username || "аккаунт без имени",
		email: email ? maskEmail(email) : undefined,
		phone: c?.phone_number ? maskPhone(c.phone_number) : undefined,
	}
}

export const autodoc = defineProvider<Tokens, ["reviews", "garage", "analogs", "basket"]>({
	id: "autodoc", name: "Autodoc", site: "https://www.autodoc.ru",
	capabilities: ["reviews", "garage", "analogs", "basket"],
	valueFlags: ["sort"],
	mapError: e => (e instanceof ApiError
		? new ProviderError(e.status === 401 ? "auth" : e.status === 404 ? "notfound" : "http", e.message) : null),

	login: async ctx => {
		if (ctx.flags.paste === true) {
			ctx.warn("Вход по сохранённой сессии браузера:\n  1. Войди на https://www.autodoc.ru\n  2. DevTools → Console → copy(JSON.stringify(sessionStorage))\n  3. Вставь буфер сюда")
			for (let attempt = 1; attempt <= 3; attempt++) {
				const parsed = auth.parsePasted(await ctx.prompt("  > "))
				if (parsed && "tokens" in parsed) return { account: parsed.tokens, display: display(parsed.tokens) }
				ctx.warn(parsed ? "  это диагностика ошибки SPA, а не токены" : "  здесь нет access_token — нужен дамп sessionStorage")
			}
			throw new ProviderError("bad_args", "три неудачные попытки")
		}
		const username = (await ctx.prompt("Логин, телефон или email > ")).trim()
		if (!username) throw new ProviderError("bad_args", "Логин не может быть пустым")
		const password = await ctx.secret("Пароль > ")
		if (!password) throw new ProviderError("bad_args", "Пароль не может быть пустым")
		let tokens: Tokens
		try {
			tokens = await auth.passwordGrant(username, password)
		} catch (e) {
			const m = e instanceof Error ? e.message : String(e)
			throw new ProviderError("auth", m.includes("invalid_grant") ? "Логин или пароль не подошли" : m)
		}
		if (!tokens.refresh_token) ctx.warn("refresh-токена нет — вход придётся повторить, когда access протухнет")
		return { account: tokens, display: display(tokens) }
	},

	whoami: async ctx => (ctx.account ? display(ctx.account) : null),

	search: async (ctx, text) => {
		const s = await api.suggest(text)
		const cats = categoryIds(s.items ?? [])
		if (!cats.length) return { items: [], total: 0, extra: { categories: [] } }
		const first = cats[0]!
		const r = await api.categoryGoods(first.id, { PageNumber: ctx.page })
		return { items: toProducts(r.items ?? [], first.title).slice(0, ctx.limit), total: r.totalCount, extra: { categories: cats } }
	},

	brands: async (_ctx, article) => {
		const { items } = await api.searchArticle(article)
		const infos = new Map(await Promise.all((items ?? []).map(async h =>
			[h.manufacturer.id, await api.goodsInfo(h.article, h.manufacturer.id).catch(() => null)] as const)))
		return { items: toBrandHits(items ?? [], infos) }
	},

	offers: async (_ctx, article, brand, { analogs }) => {
		const b = await resolveBrand(article, brand)
		const [orig, an] = await Promise.all([
			api.offers(article, b.id),
			analogs ? api.analogs(article, b.id).catch(() => null) : Promise.resolve(null),
		])
		const items = toOffers(orig, article, b.name)
		if (an) items.push(...toOffers(an, article, b.name, true))
		return { items }
	},

	reviews: async (ctx, article, brand) => {
		const b = await resolveBrand(article, brand)
		const [r, info] = await Promise.all([
			api.reviews(article, b.id, { PageNumber: ctx.page, MaxResultCount: ctx.limit }),
			api.goodsInfo(article, b.id).catch(() => null),
		])
		return toReviews(r, info)
	},

	garageExport: async () => {
		const [list, top] = await Promise.all([api.garageCars(), api.garageTopCar().catch(() => null)])
		return { cars: toCars(list.cars ?? [], top?.car?.id ?? null) }
	},

	basket: {
		list: async () => toBasket(await api.basket()),
		add: async (_ctx, ref, qty) => {
			const r = ref as unknown as AutodocRef
			if (typeof r.priceId !== "number" || !r.article) throw new ProviderError("bad_args", "ref не похож на предложение autodoc")
			await api.basketAdd(basketAddBody(r, Math.max(qty, r.minimalQuantity ?? 1)))
			return toBasket(await api.basket())
		},
		set: async (_ctx, itemId, qty) => {
			const cur = toBasket(await api.basket())
			const it = cur.items.find(i => i.id === itemId)
			if (!it) throw new ProviderError("notfound", `в корзине нет позиции ${itemId}`)
			await api.basketUpdate({ id: itemId, quantity: qty, priceType: it.extra?.priceType as number | undefined, hash: it.extra?.hash as string | undefined })
			return toBasket(await api.basket())
		},
		remove: async (_ctx, itemId) => {
			const cur = toBasket(await api.basket())
			const it = cur.items.find(i => i.id === itemId)
			if (!it) throw new ProviderError("notfound", `в корзине нет позиции ${itemId}`)
			await api.basketDelete({ items: [{ id: itemId, priceType: it.extra?.priceType as number | undefined, hash: it.extra?.hash as string | undefined }], deleteAll: false })
			return toBasket(await api.basket())
		},
	},

	commands,
})
```

`main.ts`:

```ts
#!/usr/bin/env bun
// adoc-autodoc — провайдер autodoc.ru. Справка: adoc-autodoc --help.
import { runProvider } from "../../sdk/index.ts"
import { migrateLegacyToken } from "./auth.ts"
import { autodoc } from "./provider.ts"

await migrateLegacyToken()
await runProvider(autodoc)
```

- [ ] **Step 6: Зелёные**

Run: `bun test test/providers/autodoc && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/providers/autodoc test/providers/autodoc/provider.test.ts test/fixtures/autodoc/http
git commit -m "feat(autodoc): provider on the SDK — brands, offers, search, reviews, garage export, basket"
```

---

### Task 13: Autodoc: свои команды и переключение бинаря

**Files:**
- Modify: `src/providers/autodoc/commands.ts`
- Delete: `src/main.ts`
- Modify: `package.json` (`"adoc": "./src/providers/autodoc/main.ts"` временно, до плана B)
- Test: `test/providers/autodoc/commands.test.ts`

**Interfaces:**
- Produces команды: `goods <categoryId> [--page --sort --limit]`, `info <артикул> [brandId | --brand <имя>]`, `prices <артикул> [brandId | --brand]` (сырой JSON originals), `analogs …`, `favorites [listId]`, `orders`, `profile`, `garage` (список сайта, ★ основная), `garage parts <carId>`, `garage main <carId>`, `get <путь> [k=v…] [--auth]`, `post <путь> [k=v…] [--auth]`.

- [ ] **Step 1: Тест (фикстурный режим, как в Task 12)**

`test/providers/autodoc/commands.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../../src/sdk/config.ts"
import { accountStore } from "../../../src/sdk/account.ts"

const BIN = join(import.meta.dir, "../../../src/providers/autodoc/main.ts")
const FIX = join(import.meta.dir, "../../fixtures/autodoc/http")
let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-cmds-"))
	process.env[CONFIG_DIR_ENV] = dir
	await accountStore("autodoc").save({ access_token: "a.b.c", expires_at: Math.floor(Date.now() / 1000) + 3600 })
})
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

async function run(args: string[], json = true) {
	const proc = Bun.spawn(["bun", BIN, ...args, ...(json ? ["--json"] : [])], {
		env: { ...process.env, [CONFIG_DIR_ENV]: dir, ADOC_FIXTURES: FIX, NO_COLOR: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
	})
	const out = await new Response(proc.stdout).text()
	return { code: await proc.exited, out, json: () => JSON.parse(out) }
}

describe("свои команды autodoc", () => {
	test("goods — сырой ответ", async () => {
		expect((await run(["goods", "408"])).json().totalCount).toBe(183)
	})
	test("info — карточка и цена", async () => {
		const r = await run(["info", "n90954802"])
		expect(r.json().info.rating.quantity).toBe(56)
		expect(r.json().price.minimalPrice).toBe(317)
	})
	test("info --brand по имени", async () => {
		expect((await run(["info", "n90954802", "--brand", "vag"])).code).toBe(0)
	})
	test("garage — список сайта с основной", async () => {
		expect((await run(["garage"])).json().mainCarId).toBe(10)
	})
	test("garage main без id — bad_args", async () => {
		expect((await run(["garage", "main"])).json().error.code).toBe("bad_args")
	})
	test("get — произвольный путь", async () => {
		expect((await run(["get", "/api/goods-service/goods/price", "Article=n90954802", "ManufacturerId=657"])).json().minimalPrice).toBe(317)
	})
	test("таблица без --json", async () => {
		expect((await run(["goods", "408"], false)).out).toContain("KRANZ")
	})
	test("--help перечисляет свои команды", async () => {
		expect((await run(["--help"], false)).out).toContain("garage [parts <carId> | main <carId>]")
	})
})
```

- [ ] **Step 2: Падает**

Run: `bun test test/providers/autodoc/commands.test.ts`

- [ ] **Step 3: `commands.ts`**

Перенос из `src/main.ts` (`cmdGoods`, `cmdInfo`, `cmdGarage`, `kv`) в форму `ProviderCommand`. Числовые флаги берутся через `ctx.page`/`ctx.limit`, `--sort` — свой флаг провайдера (объявлен в `valueFlags`).

```ts
// commands.ts — команды autodoc сверх контракта. Всё, что раньше было в
// src/main.ts, кроме контрактных операций.

import type { ProviderCommand } from "../../sdk/define.ts"
import { ProviderError } from "../../sdk/errors.ts"
import { bar, bold, cyan, days, dim, green, heading, money, stars, table, yellow } from "../../sdk/render.ts"
import * as api from "./api.ts"
import type { Tokens } from "./auth.ts"
import { resolveBrand } from "./brand.ts"

type Cmd = ProviderCommand<Tokens>
const need = (v: string | undefined, what: string): string => {
	if (!v) throw new ProviderError("bad_args", `нужен ${what}`)
	return v
}
const numArg = (v: string | undefined, what: string): number => {
	const n = Number(need(v, what))
	if (!Number.isFinite(n)) throw new ProviderError("bad_args", `${what} должен быть числом, а не «${v}»`)
	return n
}
const kv = (rest: string[]): Record<string, string> =>
	Object.fromEntries(rest.filter(a => a.includes("=")).map(a => { const i = a.indexOf("="); return [a.slice(0, i), a.slice(i + 1)] }))
const sortFlag = (v: string | true | undefined): number | undefined => (typeof v === "string" && v ? Number(v) : undefined)
/** brandId позиционно или --brand по имени. */
const brandArg = (args: string[], flags: Record<string, string | true>): string | undefined =>
	typeof flags.brand === "string" ? flags.brand : args[1]

const goods: Cmd = {
	usage: "goods <categoryId> [--page <n>] [--sort <id>] [--limit <n>]", about: "товары внутри категории (id даёт search)", auth: false,
	run: async (ctx, args) => {
		const r = await api.categoryGoods(numArg(args[0], "categoryId"), { PageNumber: ctx.page, SortingId: sortFlag(ctx.flags.sort) })
		return { json: r, render: () => {
			const head = dim(`всего ${r.totalCount}, страница ${ctx.page}`)
			if (!r.items?.length) return head
			return head + "\n" + table(r.items.slice(0, ctx.limit).map(g => [
				cyan(g.article), bold(g.name.slice(0, 46)), dim(g.manufacturer?.name ?? ""), money(g.price),
				g.quantity ? green(`${g.quantity} шт`) : dim("нет"), g.rating?.quantity ? `${g.rating.average.toFixed(1)}★` : dim("—"),
			]), ["АРТИКУЛ", "НАЗВАНИЕ", "ПРОИЗВОДИТЕЛЬ", "ЦЕНА", "НАЛИЧИЕ", "РЕЙТИНГ"]) +
				(r.sorting?.length ? dim(`\n--sort: ${r.sorting.map(s => `${s.id}=${s.name}`).join(", ")}`) : "")
		} }
	},
}

const info: Cmd = {
	usage: "info <артикул> [brandId | --brand <имя>]", about: "карточка: рейтинг, гистограмма, наличие", auth: false,
	run: async (ctx, args) => {
		const article = need(args[0], "артикул")
		const b = await resolveBrand(article, brandArg(args, ctx.flags))
		const [inf, price] = await Promise.all([api.goodsInfo(article, b.id), api.goodsPrice(article, b.id).catch(() => null)])
		return { json: { info: inf, price }, render: () => [
			`${bold(inf.name)}  ${dim(inf.article)}`, `${inf.manufacturer.name}  ${dim(`id ${inf.manufacturer.id}`)}`,
			heading("Оценки"), `  ${stars(inf.rating?.average)}  ${bold(inf.rating?.average?.toFixed(2) ?? "—")}  ${dim(`${inf.rating?.quantity ?? 0} оценок`)}`,
			...bar(inf.rating?.ratings),
			heading("Наличие и цена"), `  минимальная цена  ${bold(money(price?.minimalPrice))}`, `  срок              ${days(price?.minimalDeliveryDays)}`,
			`  на складе         ${inf.inStock ? green(`${inf.inStock} шт`) : dim("нет")}`,
			dim(`\nhttps://www.autodoc.ru/price/${inf.manufacturer.id}/${inf.article}`),
		].join("\n") }
	},
}

const rawByBrand = (usage: string, about: string, fn: (a: string, id: number) => Promise<unknown>): Cmd => ({
	usage, about, auth: true,
	run: async (ctx, args) => {
		const article = need(args[0], "артикул")
		const b = await resolveBrand(article, brandArg(args, ctx.flags))
		return { json: await fn(article, b.id) }
	},
})

const garage: Cmd = {
	usage: "garage [parts <carId> | main <carId>]", about: "гараж сайта: список, подборка под машину, основная", auth: true,
	run: async (_ctx, args) => {
		const [sub, arg] = args
		if (sub === "main") {
			const id = numArg(arg, "id машины: `garage main <carId>`")
			await api.garageSetMain(id)
			return { json: { ok: true, mainCarId: id }, render: () => green(`основной автомобиль теперь ${id}`) }
		}
		if (sub === "parts") {
			const r = await api.garageProducts(numArg(arg, "id машины: `garage parts <carId>`"))
			return { json: r, render: () => {
				const goodsList = r.goods ?? []
				if (!goodsList.length) return dim("подборки для этой машины нет")
				return (r.modification ? dim(r.modification) + "\n" : "") + table(goodsList.map(g => {
					const best = (g.items ?? []).reduce<{ price?: number; deliveryDays?: number } | null>(
						(acc, it) => (acc === null || (it.price ?? Infinity) < (acc.price ?? Infinity) ? it : acc), null)
					return [cyan(g.article), bold(g.name.slice(0, 40)), dim(g.manufacturer?.name ?? ""), money(best?.price), days(best?.deliveryDays), dim(g.groupName ?? "")]
				}), ["АРТИКУЛ", "НАЗВАНИЕ", "ПРОИЗВОДИТЕЛЬ", "ОТ", "СРОК", "ГРУППА"])
			} }
		}
		if (sub) throw new ProviderError("bad_args", `неизвестная подкоманда гаража: ${sub}`)
		const [list, top] = await Promise.all([api.garageCars(), api.garageTopCar().catch(() => null)])
		const mainId = top?.car?.id ?? null
		return { json: { ...list, mainCarId: mainId }, render: () => {
			const cars = list.cars ?? []
			if (!cars.length) return dim("гараж пуст")
			return table(cars.map(c => [c.id === mainId ? yellow("★") : " ", cyan(String(c.id)), bold([c.brand, c.model].filter(Boolean).join(" ")),
				c.engine ?? dim("—"), c.year ? String(c.year) : dim("—"), c.vin ?? dim("—"), c.odometer ? `${c.odometer.toLocaleString("ru-RU")} км` : dim("—")]),
				[" ", "ID", "АВТОМОБИЛЬ", "ДВИГАТЕЛЬ", "ГОД", "VIN", "ПРОБЕГ"]) + dim("\n\n★ — основная; `garage parts <id>` — подборка под неё")
		} }
	},
}

const raw = (method: "GET" | "POST"): Cmd => ({
	usage: `${method.toLowerCase()} <путь> [k=v ...] [--auth]`, about: `произвольный ${method} к web.autodoc.ru`, auth: false,
	run: async (ctx, args) => ({ json: await api.raw(method, need(args[0], "путь"), kv(args.slice(1)), ctx.flags.auth === true) }),
})

export const commands: Record<string, Cmd> = {
	goods, info,
	prices: rawByBrand("prices <артикул> [brandId | --brand <имя>]", "сырые предложения продавцов (originals)", api.offers),
	analogs: rawByBrand("analogs <артикул> [brandId | --brand <имя>]", "сырые аналоги", api.analogs),
	favorites: { usage: "favorites [listId]", about: "избранное; без аргумента — списки", auth: true,
		run: async (_ctx, args) => ({ json: args[0] ? await api.favorites(numArg(args[0], "listId")) : await api.favoriteLists() }) },
	orders: { usage: "orders", about: "заказы", auth: true, run: async () => ({ json: await api.orders() }) },
	profile: { usage: "profile", about: "сводка по аккаунту", auth: true, run: async () => ({ json: await api.profile() }) },
	garage,
	get: raw("GET"), post: raw("POST"),
}
```

- [ ] **Step 4: Переключить бинарь и удалить старый `main.ts`**

```bash
git rm src/main.ts
```

В `package.json` поле `bin.adoc` → `"./src/providers/autodoc/main.ts"`. Это временно до плана B; зафиксировать в сообщении коммита.

- [ ] **Step 5: Зелёные и живая проверка**

Run: `bun test && bun run typecheck`
Expected: всё PASS.

Живая проверка (нужна сеть и твой аккаунт; первый запуск перенесёт `token.json`):

```bash
bun src/providers/autodoc/main.ts whoami
bun src/providers/autodoc/main.ts brands n90954802
bun src/providers/autodoc/main.ts offers n90954802 --brand VAG
bun src/providers/autodoc/main.ts offers n90954802 --brand VAG --analogs --json | head -c 600
bun src/providers/autodoc/main.ts search болт
bun src/providers/autodoc/main.ts reviews n90954802 --brand VAG --limit 2
bun src/providers/autodoc/main.ts garage export
bun src/providers/autodoc/main.ts basket
```

Expected: `whoami` показывает аккаунт, `~/.config/adoc/accounts/autodoc.json` появился, `token.json` исчез; `offers` печатает таблицу с 30+ строками и колонкой ПРОДАВЕЦ; `basket` — «корзина пуста».

Проверка корзины (кладёт одну позицию и убирает её):

```bash
REF=$(bun src/providers/autodoc/main.ts offers n90954802 --brand VAG --json | bun -e 'const j=await Bun.stdin.json(); console.log(JSON.stringify(j.items[0].ref))')
bun src/providers/autodoc/main.ts basket add --ref "$REF" --qty 1 --json | head -c 800
```

По выводу — реальную форму позиции корзины записать в `test/fixtures/autodoc/basket-items.json` и `test/fixtures/autodoc/http/GET__api_basket-service_basket_items.json` (заменить выдуманные поля реальными), поправить `toBasket` и тест `toBasket`, если имена полей другие (`article`/`displayArticle`/`manufacturer`/`total`/`deliveryDays`). Затем:

```bash
ID=$(bun src/providers/autodoc/main.ts basket --json | bun -e 'const j=await Bun.stdin.json(); console.log(j.items[0].id)')
bun src/providers/autodoc/main.ts basket set "$ID" --qty 2
bun src/providers/autodoc/main.ts basket rm "$ID"
bun src/providers/autodoc/main.ts basket
```

Expected: количество меняется, после `rm` — «корзина пуста». Если `set`/`rm` отвечают 400 — тело не совпало с фронтом; формы тел, снятые с бандла 2026-09-01: PUT `{id, quantity, description, priceType, hash}`, DELETE `{items: [{id, priceType, hash}], deleteAll: false}`.

- [ ] **Step 6: Commit**

```bash
git add -A src/providers/autodoc src/main.ts package.json test/providers/autodoc test/fixtures/autodoc
git commit -m "feat(autodoc): own commands on the SDK; adoc bin points to the autodoc provider until the aggregator lands"
```

---

### Task 14: Документация плана A

**Files:**
- Create: `docs/contract.md`
- Modify: `README.md` (раздел про запуск: команды теперь `adoc-autodoc …`, `adoc` временно то же самое)
- Modify: `skills/adoc/SKILL.md` (имена команд и флаг `--brand`)

**Interfaces:** нет.

- [ ] **Step 1: `docs/contract.md`**

Перенести раздел «Контракт v1» из спеки как самостоятельный документ. Обязательное содержание:

1. Протокол `--json`: провайдер — исполняемый файл `adoc-<id>`, агрегатор зовёт `<провайдер> <команда> … --json`, читает один JSON из stdout; stderr — для человека.
2. Таблицы обязательных и необязательных команд (из спеки, плюс `logout`, который SDK даёт всем).
3. Типы — скопировать блок из `src/sdk/contract.ts` целиком, чтобы документ был самодостаточен.
4. Ошибки и exit-коды, правила для провайдеров (с правкой из Task 1: провайдер владеет файлом аккаунта).
5. Примеры: `adoc-autodoc brands n90954802 --json` → ответ, обрезанный до одного элемента; `adoc-autodoc offers n90954802 --brand VAG --json` без входа → `{"error":{"code":"auth","message":"…"}}`.
6. «Как написать провайдера на TypeScript»: первые 20 строк `test/fixtures/fake-provider.ts` и ссылка на `src/sdk/index.ts`. «На другом языке»: исполняемый `adoc-<id>` в PATH, обязан отвечать на `describe`, файл аккаунта — `$ADOC_CONFIG_DIR/accounts/<id>.json`.

- [ ] **Step 2: README и SKILL**

В README таблицу команд оставить, заменить `adoc` на `adoc-autodoc` в примерах, `[brandId]` на `[brandId | --brand <имя>]`, добавить строки `describe`, `brands`, `offers`, `basket add/set/rm`, `garage export`; в разделе «Авторизация» путь файла `~/.config/adoc/accounts/autodoc.json`. Добавить абзац: «`adoc` сейчас — то же, что `adoc-autodoc`; агрегатор по нескольким сайтам появится следующим шагом, контракт провайдера — `docs/contract.md`».

В SKILL: те же имена команд; ловушку 3 переписать: «`{"error":{"code":"auth"}}` в `--json` или текст в stderr = нужен `adoc-autodoc login`».

- [ ] **Step 3: Проверить и commit**

Run: `bun test && bun run typecheck`

```bash
git add docs/contract.md README.md skills/adoc/SKILL.md
git commit -m "docs: provider contract v1, README and skill for adoc-autodoc"
```

---

## Чек-лист живой проверки после плана A

1. `adoc-autodoc --help` показывает контрактные и свои команды.
2. `adoc-autodoc login` → `whoami` → `logout` → `whoami` (ok: false).
3. `adoc-autodoc login --paste` с дампом sessionStorage.
4. `brands`, `offers` (с `--analogs`), `search`, `reviews`, `garage export`, `basket` — таблицы и `--json`.
5. `offers n90954802 --brand BOSCH` → exit 2 и список брендов.
6. Все старые команды (`goods 408`, `info n90954802`, `garage`, `garage parts <id>`, `orders`, `get …`) работают.
7. `bun test` без сети: `ADOC_CONFIG_DIR` и `ADOC_FIXTURES` не оставляют файлов в `~/.config/adoc`.

## Что дальше

- **План B** — агрегатор `adoc`: `core/registry`, `core/invoke`, `part`, `search`, `reviews`, `basket`, `garage`, `accounts`, README и скилл под мультипровайдер.
- **План C** — провайдер armtek: `docs/armtek-api.md`, поиск ленты отзывов и тел корзины, `src/providers/armtek/`.

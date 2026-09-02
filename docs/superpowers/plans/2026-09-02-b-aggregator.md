# План B: агрегатор `adoc` поверх провайдеров

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Написать обёртку `adoc` — она находит провайдеров, опрашивает их параллельно и печатает единую выдачу: `part`, `search`, `reviews`, `basket`, `garage`, `login/logout/whoami/accounts`, `providers` и проброс `adoc <provider> …`.

**Architecture:** Агрегатор не импортирует провайдеров. Он находит их как исполняемые файлы (`src/providers/*/main.ts` рядом с собой и `adoc-*` в `PATH`), запускает `<бинарь> <команда> … --json` отдельным процессом и читает из stdout ровно один JSON-объект. Всё, что пришло, проверяется по контракту, склеивается по ключам артикула и бренда и рисуется таблицами агрегатора. Провайдер, который упал, попадает жёлтой строкой в stderr и полем `errors` — остальные печатаются. Своего состояния у агрегатора два файла: `garage.json` и `last-part.json`; аккаунты пишут сами провайдеры, обёртка их только перечисляет и удаляет.

**Tech Stack:** Bun 1.3, TypeScript strict, `bun test`, без внешних зависимостей в рантайме; `typescript` только как devDependency для `tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-09-01-multi-provider-design.md` — разделы «Архитектура» (включая «Обнаружение провайдеров» и «Вызов провайдера»), «Хранилище», «Команды обёртки», «Тесты», «Документация». Контракт, который агрегатор потребляет, — `docs/contract.md`. Предыдущий план (SDK и провайдеры) — `docs/superpowers/plans/2026-09-01-a-sdk-and-autodoc.md`.

## Global Constraints

- Bun 1.3; TypeScript strict плюс `noUncheckedIndexedAccess` (уже в `tsconfig.json`).
- Без внешних зависимостей в рантайме; `typescript` и `@types/bun` — только devDependencies.
- Отступ — табуляция, как во всём существующем коде.
- Комментарии, сообщения пользователю и документация — по-русски. Идентификаторы — по-английски.
- Имя тулзы пока `adoc`; единственная константа `TOOL` в `src/sdk/config.ts`, каталог конфига `$ADOC_CONFIG_DIR` → `$XDG_CONFIG_HOME/adoc` → `~/.config/adoc`.
- Файлы аккаунтов `accounts/<id>.json` с правами `0o600` пишет провайдер; пароли на диск не пишутся.
- С `--json` в stdout ровно один JSON-объект и ничего больше; подсказки и прогресс — в stderr.
- Exit-коды: `0` успех (пустой результат — тоже `0`), `1` ошибка, `2` `ambiguous`.
- Без сети в `bun test`: провайдеры в тестах — фикстуры из `test/fixtures/`, реестр подменяется `ADOC_PROVIDERS_DIR`, конфиг — `ADOC_CONFIG_DIR` во временном каталоге.
- Один коммит на задачу; `bun test` и `bun run typecheck` зелёные перед каждым коммитом.
- Трейлер каждого коммита: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Что уже сделано и не переделывается

`src/sdk/` и провайдеры `autodoc`/`armtek` готовы (план A, 213 тестов зелёные). Агрегатор:

- **не** импортирует код провайдеров — только запускает их процессы;
- **не** дублирует `articleKey`/`brandKey`, `table`, `money`, `days`, `stars`, `bar`, `fold`, `fields`, `renderReviews`, `renderDisplay`, `renderCars` — берёт их из `src/sdk/`;
- **не** пишет `accounts/<id>.json` — это делает провайдер (зафиксировано в плане A);
- переиспользует `ProviderError`, `errorBody`, `exitCode` из `src/sdk/errors.ts`: коды и отображение в exit те же самые, второй набор развёлся бы с первым;
- переиспользует `parseArgv` из `src/sdk/cli.ts`: соглашения о флагах у обёртки и у провайдера обязаны совпадать (`--flag value`, `--flag=value`, значение обязательно, булев флаг берёт только `true`/`false`).

## Правки в SDK, которые нужны агрегатору

Обе — мелкие, обе с причиной, обе делаются в задаче 1:

1. `src/sdk/out.ts`: функция `emit(sink, text, code)` выносится из `src/sdk/run.ts` и экспортируется. Причина: у агрегатора та же беда, что у провайдера, — `process.exit` обрезает stdout за первым буфером пайпа (64 КБ), а `adoc part --json` по нескольким провайдерам этот буфер перерастает. Копировать хитрость в двух местах — заводить два разных бага.
2. `src/sdk/index.ts`: к экспортам добавляются `parseArgv`, `errorBody`, `exitCode`, `emit` и тип `Flags`. Причина: сегодня они доступны только глубоким импортом (`../sdk/cli.ts`), а агрегатор — первый внешний потребитель ровно этих трёх вещей.
3. `src/sdk/render.ts`: `ratingCell` и `qtyCell` становятся `export const` (сейчас они приватные). Причина: агрегатор рисует те же колонки «РЕЙТИНГ» и «НАЛИЧИЕ», и форматировать их вторым, чуть-чуть другим кодом — верный способ получить две разные таблицы для одних и тех же данных.

Больше в SDK и в провайдерах ничего не меняется.

## Структура файлов

```
src/
  main.ts                 бинарь adoc: проброс или run(), единственный process.exit
  app.ts                  run(argv) → {stdout, stderr, code}; разбор argv, таблица команд
  core/
	ctx.ts                типы Ctx и Output — общий язык команд
	args.ts               need/limitOf/pageOf/qtyOf/refOf/one — разбор аргументов команд
	store.ts              файлы агрегатора: атомарный readJson/writeJson, список и удаление аккаунтов
	registry.ts           обнаружение провайдеров, describe на запуск, выбор по --only/--skip
	validate.ts           проверка форм ответов провайдера по контракту
	invoke.ts             spawn провайдера, таймаут, вырезание JSON, маппинг ошибок
	partial.ts            частичный отказ: fanout, Failure, жёлтые строки
	render.ts             таблицы агрегатора (колонка ПРОВАЙДЕР, колонка ГДЕ, блоки корзин)
	merge.ts              склейка брендов, предложений и товаров между провайдерами
	brand.ts              общий шаг «артикул → бренд» для part и reviews
	errors.ts             Ambiguous — ошибка «уточни бренд» с таблицей вариантов
	lastpart.ts           last-part.json: сохранение выдачи part и строка по номеру
	garage.ts             garage.json: чтение, запись, add/rm/main, слияние импорта
	help.ts               справка обёртки, строки провайдеров из describe
  commands/
	providers.ts          adoc providers
	accounts.ts           adoc accounts | whoami | login | logout
	part.ts               adoc part
	search.ts             adoc search
	reviews.ts            adoc reviews
	basket.ts             adoc basket [add|set|rm]
	garage.ts             adoc garage [add|rm|main|import]
	passthrough.ts        adoc <provider> … — проброс stdio и кода возврата
test/
  core/{store,registry,invoke,partial,merge,lastpart,garage}.test.ts
  commands/{providers,accounts,part,search,reviews,basket,garage,passthrough,help}.test.ts
  fixtures/fake/provider.ts              makeFake(id, data) — фиктивный провайдер под любой id
  fixtures/providers/{alpha,beta}/main.ts  нормальные фиктивные провайдеры
  fixtures/odd/{noisy,sleepy,broken}/main.ts  грязный stdout, зависший, битый describe
```

Один файл — одна ответственность. `core/` ничего не знает про argv, `commands/` — про spawn, `app.ts` — про формы ответов провайдеров.

---

### Task 1: Бинарь `adoc`, каркас `run()` и две правки SDK

**Files:**
- Modify: `package.json`
- Create: `src/sdk/out.ts`
- Modify: `src/sdk/run.ts`
- Modify: `src/sdk/index.ts`
- Modify: `src/sdk/render.ts`
- Create: `src/app.ts`
- Create: `src/main.ts`
- Test: `test/core/app.test.ts`

**Interfaces:**
- Consumes: `parseArgv(argv, valueFlags)`, `errorBody(e)`, `exitCode(code)` из `src/sdk/`.
- Produces: `emit(sink, text, code): Promise<never>`; `run(argv: string[]): Promise<{stdout: string; stderr: string; code: number}>`; бинарь `adoc` → `src/main.ts`.

- [ ] **Step 1: Тест каркаса**

`test/core/app.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { run } from "../../src/app.ts"

describe("run", () => {
	test("--help печатает справку обёртки", async () => {
		const r = await run(["--help"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("part")
		expect(r.stdout).toContain("providers")
	})

	test("без аргументов — та же справка", async () => {
		const r = await run([])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("part")
	})

	test("неизвестная команда — bad_args в stderr", async () => {
		const r = await run(["нетакой"])
		expect(r.code).toBe(1)
		expect(r.stdout).toBe("")
		expect(r.stderr).toContain("неизвестная команда")
	})

	test("неизвестная команда с --json — тело ошибки в stdout", async () => {
		const r = await run(["нетакой", "--json"])
		expect(r.code).toBe(1)
		expect(JSON.parse(r.stdout).error.code).toBe("bad_args")
	})

	test("ошибка разбора флагов приходит в том же виде", async () => {
		const r = await run(["part", "N1", "--limit", "--json"])
		expect(r.code).toBe(1)
		expect(JSON.parse(r.stdout).error.code).toBe("bad_args")
	})

	test("бинарь запускается и печатает справку", async () => {
		const bin = join(import.meta.dir, "..", "..", "src", "main.ts")
		const proc = Bun.spawn(["bun", bin, "--help"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
		const out = await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(0)
		expect(out).toContain("part")
	})
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/core/app.test.ts`
Expected: FAIL, `Cannot find module '../../src/app.ts'`.

- [ ] **Step 3: Вынести `emit` в `src/sdk/out.ts`**

`src/sdk/out.ts`:

```ts
// out.ts — единственная точка выхода из процесса. process.exit рубит всё, что
// ещё не ушло в трубу: через пайп оболочки Bun 1.3 теряет хвост за первым
// буфером (64 КБ), и ответ крупнее буфера уезжал бы обрезанным с кодом 0 —
// успех на неразбираемом JSON. Поэтому сначала дожидаемся слива, потом выходим.

export type Sink = { write(text: string, cb: () => void): unknown }

export async function emit(sink: Sink, text: string, code: number): Promise<never> {
	await new Promise<void>(resolve => sink.write(text, () => resolve()))
	process.exit(code)
}
```

В `src/sdk/run.ts` удалить тип `Sink` и функцию `emit` вместе с их комментарием (строки с `type Sink = …` по конец `async function emit`) и добавить импорт рядом с остальными:

```ts
import { emit } from "./out.ts"
```

В `src/sdk/render.ts` открыть два форматтера ячеек — заменить `const ratingCell` на `export const ratingCell` и `const qtyCell` на `export const qtyCell`.

В `src/sdk/index.ts` добавить строки:

```ts
export { emit } from "./out.ts"
export { parseArgv } from "./cli.ts"
export type { Flags } from "./cli.ts"
export { errorBody, exitCode } from "./errors.ts"
```

- [ ] **Step 4: `src/app.ts` — каркас**

```ts
// app.ts — argv агрегатора: разбор, выбор команды, сбор вывода. Сам ничего не
// печатает: строки копятся и уходят наружу одним куском, чтобы большой --json
// не обрезался на пайпе (см. sdk/out.ts) и чтобы run() был проверяем тестом.

import { ProviderError, errorBody, exitCode, parseArgv } from "./sdk/index.ts"
import { red } from "./sdk/render.ts"

// Флаги обёртки, которые берут значение. Булевы (--json, --analogs) сюда не
// входят: parseArgv развернёт их сам.
const VALUE_FLAGS = [
	"only", "providers", "skip", "limit", "page", "qty", "ref",
	"brand", "model", "modification", "year", "engine", "vin", "odometer",
]

const HELP = `adoc — поиск запчастей сразу по нескольким магазинам

  part <артикул> [бренд]     предложения всех сайтов одной таблицей
  search <текст>             поиск по названию
  reviews <артикул> [бренд]  оценки и отзывы
  basket [add|set|rm]        корзины всех сайтов
  garage [add|rm|main]       свой гараж, живёт локально
  login|logout <provider>    вход и выход у сайта
  accounts | whoami          кто авторизован
  providers                  какие сайты подключены
  <provider> <команда> …     команда самого сайта как есть

  --json  --only a,b  --skip a,b  --limit <n>  --page <n>  --analogs
`

export type RunResult = { stdout: string; stderr: string; code: number }

export async function run(argv: string[]): Promise<RunResult> {
	// Форма ответа зависит от --json, а разбор argv умеет падать: флаг ищем в
	// сыром argv, иначе ошибка разбора уехала бы машинному вызову текстом.
	const json = argv.some(a => a === "--json" || a === "--json=true")
	let stderr = ""
	const warn = (line: string): void => { stderr += line.endsWith("\n") ? line : `${line}\n` }

	try {
		const { args, flags } = parseArgv(argv, VALUE_FLAGS)
		const name = args[0]
		if (!name || flags.help) return { stdout: HELP, stderr, code: 0 }
		// Команды появляются в задачах 6–14; до тех пор известных имён нет.
		throw new ProviderError("bad_args", `неизвестная команда: ${name} — смотри adoc --help`)
	} catch (e) {
		// Код в теле и код возврата — из одного места, иначе текстовый и
		// машинный ответы разошлись бы.
		const body = errorBody(e)
		const code = exitCode(body.error.code)
		if (json) return { stdout: `${JSON.stringify(body)}\n`, stderr, code }
		return { stdout: "", stderr: `${stderr}${red(body.error.message)}\n`, code }
	}
}
```

Переменная `warn` пока не используется ни одной командой — она заводится здесь,
чтобы форма `run()` не менялась в задаче 6, когда команды появятся.

- [ ] **Step 5: `src/main.ts`**

```ts
#!/usr/bin/env bun
// adoc — агрегатор магазинов автозапчастей. Справка: adoc --help.

import { run } from "./app.ts"
import { emit } from "./sdk/out.ts"

const r = await run(process.argv.slice(2))
if (r.stderr) process.stderr.write(r.stderr)
await emit(process.stdout, r.stdout, r.code)
```

- [ ] **Step 6: Бинарь в `package.json`**

Заменить блок `bin` на:

```json
	"bin": {
		"adoc": "./src/main.ts",
		"adoc-autodoc": "./src/providers/autodoc/main.ts",
		"adoc-armtek": "./src/providers/armtek/main.ts"
	},
```

- [ ] **Step 7: Всё зелёное**

Run: `bun test && bun run typecheck`
Expected: PASS, включая старые 213 тестов — правка `run.ts` не должна ломать `sdk/run.test.ts` («большой ответ не режется на пайпе»).

- [ ] **Step 8: Commit**

```bash
git add package.json src/sdk/out.ts src/sdk/run.ts src/sdk/index.ts src/sdk/render.ts src/app.ts src/main.ts test/core/app.test.ts
git commit -m "feat(core): adoc binary and aggregator skeleton

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Хранилище агрегатора

**Files:**
- Create: `src/core/store.ts`
- Test: `test/core/store.test.ts`

**Interfaces:**
- Consumes: `configDir()` из `src/sdk/config.ts`.
- Produces: `filePath(name): string`, `readJson<T>(name): Promise<T | null>`, `writeJson(name, data): Promise<void>`, `removeFile(name): Promise<boolean>`, `listAccountIds(): Promise<string[]>`, `removeAccount(id): Promise<boolean>`.

- [ ] **Step 1: Тест**

`test/core/store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { accountStore } from "../../src/sdk/account.ts"
import { filePath, listAccountIds, readJson, removeAccount, removeFile, writeJson } from "../../src/core/store.ts"

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

	test("removeFile сообщает, был ли файл", async () => {
		await writeJson("last-part.json", {})
		expect(await removeFile("last-part.json")).toBe(true)
		expect(await removeFile("last-part.json")).toBe(false)
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
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/core/store.test.ts`
Expected: FAIL, `Cannot find module '../../src/core/store.ts'`.

- [ ] **Step 3: Реализация**

`src/core/store.ts`:

```ts
// store.ts — файлы, которыми владеет сама обёртка: garage.json и
// last-part.json. Запись атомарная (tmp + rename): прерванный на середине
// процесс иначе оставил бы обрезанный гараж, а он единственный экземпляр.
// Файлы аккаунтов пишет провайдер — обёртке позволено только перечислить и
// удалить, поэтому здесь нет ни одной записи в accounts/.

import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { configDir } from "../sdk/config.ts"

export const filePath = (name: string): string => join(configDir(), name)

export async function readJson<T>(name: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(filePath(name), "utf8")) as T
	} catch {
		// Нет файла и битый файл — одно и то же: состояния нет. Падать на
		// испорченном кэше выдачи незачем, он перезапишется следующей командой.
		return null
	}
}

export async function writeJson(name: string, data: unknown): Promise<void> {
	const path = filePath(name)
	await mkdir(dirname(path), { recursive: true })
	const tmp = `${path}.${process.pid}.tmp`
	try {
		await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`)
		await rename(tmp, path)
	} catch (e) {
		await unlink(tmp).catch(() => {})
		throw e
	}
}

/** true — файл был и удалён, false — его и не было. */
export async function removeFile(name: string): Promise<boolean> {
	try {
		await unlink(filePath(name))
		return true
	} catch {
		return false
	}
}

const accountsDir = (): string => join(configDir(), "accounts")

/** Кто вошёл хоть раз: имена файлов accounts/<id>.json. Содержимое не читается. */
export async function listAccountIds(): Promise<string[]> {
	try {
		const names = await readdir(accountsDir())
		return names.filter(n => n.endsWith(".json")).map(n => n.slice(0, -".json".length)).sort()
	} catch {
		return []
	}
}

export async function removeAccount(id: string): Promise<boolean> {
	try {
		await unlink(join(accountsDir(), `${id}.json`))
		return true
	} catch {
		return false
	}
}
```

- [ ] **Step 4: Зелёные тесты**

Run: `bun test test/core/store.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/store.ts test/core/store.test.ts
git commit -m "feat(core): atomic aggregator store and account listing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: Реестр провайдеров, проверка форм и фиктивные провайдеры

**Files:**
- Create: `src/core/registry.ts`
- Create: `src/core/validate.ts`
- Create: `test/fixtures/fake/provider.ts`
- Create: `test/fixtures/providers/alpha/main.ts`
- Create: `test/fixtures/providers/beta/main.ts`
- Create: `test/fixtures/odd/noisy/main.ts`
- Create: `test/fixtures/odd/broken/main.ts`
- Create: `test/fixtures/sleepy.ts`
- Test: `test/core/registry.test.ts`

**Interfaces:**
- Consumes: `TOOL` из `src/sdk/config.ts`, `ProviderError` из `src/sdk/index.ts`, типы контракта.
- Produces: `PROVIDERS_DIR_ENV = "ADOC_PROVIDERS_DIR"`; типы `ProviderEntry = {id, bin: string[], source}`, `Provider = ProviderEntry & {describe: Describe}`, `BadProvider = ProviderEntry & {message}`, `Loaded = {ok: Provider[]; bad: BadProvider[]}`; `discover(): Promise<ProviderEntry[]>`; `select(ok: Provider[], flags: Flags, cap?: Capability): Provider[]`; из `validate.ts` — `parseDescribe`, `parseBrands`, `parseOffers`, `parseProducts`, `parseReviews`, `parseBasket`, `parseCars`, `parseWhoami`, `parseDisplay`.
- Produces (тесты): `makeFake(id, data): ProviderSpec<Account>` и каталоги фиктивных провайдеров.

- [ ] **Step 1: Фиктивный провайдер под любой id**

`test/fixtures/fake/provider.ts`:

```ts
// Фиктивный провайдер: без сети, всё в памяти и в паре файлов конфига.
// Один и тот же код играет разные роли — id и данные задаёт makeFake, а
// поведение крутится переменными окружения FAKE_<ID>_<КНОПКА>:
//   DELAY=<мс>     ответить с задержкой (проверка таймаута)
//   FAIL=<код>     любая контрактная команда падает этим кодом
//   AMBIGUOUS=1    brands возвращает ambiguous (exit 2) вместо списка

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ProviderError, articleKey, brandKey, configDir, defineProvider } from "../../../src/sdk/index.ts"
import type { Basket, ErrorCode, Offer, ProviderSpec } from "../../../src/sdk/index.ts"

export type FakeAccount = { token: string; user: string }
export type FakeData = { article: string; brand: string; price: number; seller: string }

const knob = (id: string, name: string): string | undefined => process.env[`FAKE_${id.toUpperCase()}_${name}`]

export function makeFake(id: string, data: FakeData): ProviderSpec<FakeAccount> {
	const gate = async (): Promise<void> => {
		const delay = knob(id, "DELAY")
		if (delay) await Bun.sleep(Number(delay))
		const fail = knob(id, "FAIL")
		if (fail) throw new ProviderError(fail as ErrorCode, `${id}: так велено переменной окружения`)
	}

	// Товарная база: два артикула. Второй — с двумя брендами, на нём
	// проверяется неоднозначность на уровне обёртки (у одного сайта два
	// производителя одного артикула), написанная у alpha и beta по-разному.
	type Row = { article: string; brand: string; name: string; price: number }
	const rows: Row[] = [
		{ article: data.article, brand: data.brand, name: "Болт", price: data.price },
		{ article: "MULTI-1", brand: data.brand, name: "Колодки", price: data.price + 100 },
		{ article: "MULTI 1", brand: "OTHER", name: "Колодки OTHER", price: data.price + 200 },
	]
	const find = (article: string): Row[] => rows.filter(r => articleKey(r.article) === articleKey(article))
	const toOffer = (r: Row, n: number): Offer => ({
		article: r.article, brand: r.brand, name: r.name, price: r.price, currency: "RUB",
		quantity: 3, deliveryDays: 2, seller: data.seller, rating: { average: 4.5, count: 10 },
		ref: { line: `${id}-${n}` },
	})

	return defineProvider<FakeAccount, ["reviews", "garage", "analogs", "basket"]>({
		id, name: `Fake ${id}`, site: `https://${id}.example`,
		capabilities: ["reviews", "garage", "analogs", "basket"],

		login: async ctx => {
			const user = knob(id, "LOGIN") ?? await ctx.prompt("Логин > ")
			const password = knob(id, "PASSWORD") ?? await ctx.secret("Пароль > ")
			if (password !== "pw") throw new ProviderError("auth", "Логин или пароль не подошли")
			return { account: { token: `t-${user}`, user }, display: { name: user, email: `${user}@${id}.example` } }
		},
		whoami: async ctx => (ctx.account ? { name: ctx.account.user, email: `${ctx.account.user}@${id}.example` } : null),

		search: async (_ctx, text) => {
			await gate()
			if (text !== "болт") return { items: [] }
			return {
				items: [
					{ article: data.article, brand: data.brand, name: "Болт", price: data.price, quantity: 3, rating: { average: 4.5, count: 10 } },
					{ article: `${id.toUpperCase()}-ONLY`, brand: "OWN", name: `Своё у ${id}`, price: 100 },
				],
				total: 2,
			}
		},

		brands: async (_ctx, article) => {
			await gate()
			if (knob(id, "AMBIGUOUS")) throw new ProviderError("ambiguous", "уточни бренд", [{ brand: "AAA", article }, { brand: "BBB", article }])
			return { items: find(article).map(r => ({ brand: r.brand, article: r.article, name: r.name, rating: { average: 4.5, count: 10 } })) }
		},

		offers: async (_ctx, article, brand, { analogs }) => {
			await gate()
			const hit = find(article).filter(r => brandKey(r.brand) === brandKey(brand))
			const items = hit.map((r, i) => toOffer(r, i + 1))
			// Аналог — другой артикул: обёртка обязана унести его в отдельную таблицу.
			if (analogs && hit.length) items.push({ ...toOffer(hit[0]!, 9), article: "AN-1", brand: "ANALOG", price: data.price + 50, analog: true })
			return { items }
		},

		reviews: async () => {
			await gate()
			return { total: 1, rating: { average: 4.5, count: 10, histogram: [8, 1, 1, 0, 0] }, items: [{ text: `отзыв у ${id}`, rating: 5, date: "2026-01-02" }] }
		},

		garageExport: async ctx => {
			auth(ctx.account)
			await gate()
			return { cars: [{ brand: "SKODA", model: "OCTAVIA III", modification: "1.8 TSI", year: 2017, vin: "TMBAG7NE0H0000001", ref: { carId: 1, source: id } }] }
		},

		basket: {
			list: async ctx => { auth(ctx.account); await gate(); return await load() },
			add: async (ctx, ref, qty) => {
				auth(ctx.account)
				await gate()
				const b = await load()
				const itemId = String(ref.line ?? "x")
				const items = b.items.some(i => i.id === itemId)
					? b.items.map(i => (i.id === itemId ? { ...i, quantity: i.quantity + qty } : i))
					: [...b.items, { id: itemId, article: data.article, brand: data.brand, name: "Болт", price: data.price, quantity: qty, deliveryDays: 2 }]
				return await store({ ...b, items })
			},
			set: async (ctx, itemId, qty) => {
				auth(ctx.account)
				const b = await load()
				return await store({ ...b, items: b.items.map(i => (i.id === itemId ? { ...i, quantity: qty } : i)) })
			},
			remove: async (ctx, itemId) => {
				auth(ctx.account)
				const b = await load()
				return await store({ ...b, items: b.items.filter(i => i.id !== itemId) })
			},
		},

		commands: {
			hello: { usage: "hello [имя]", about: "своя команда провайдера", auth: false, run: async (_ctx, args) => ({ json: { hello: args[0] ?? id }, render: () => `привет, ${args[0] ?? id}` }) },
		},
	})
}
```

- [ ] **Step 2: Каталоги фиктивных провайдеров**

`test/fixtures/providers/alpha/main.ts`:

```ts
import { runProvider } from "../../../../src/sdk/index.ts"
import { makeFake } from "../../fake/provider.ts"

// Артикул и бренд написаны «канонично», цена выше, чем у beta.
await runProvider(makeFake("alpha", { article: "N90954802", brand: "VAG", price: 407, seller: "склад А" }))
```

`test/fixtures/providers/beta/main.ts`:

```ts
import { runProvider } from "../../../../src/sdk/index.ts"
import { makeFake } from "../../fake/provider.ts"

// Тот же товар другим написанием и дешевле: на этой паре проверяется склейка
// по ключам артикула и бренда и сортировка по цене.
await runProvider(makeFake("beta", { article: "N 909 548 02", brand: "vag", price: 380, seller: "склад Б" }))
```

`test/fixtures/odd/noisy/main.ts`:

```ts
// Провайдер-грязнуля: печатает мусор вокруг JSON и строку в stderr. Не SDK:
// именно так себя ведёт чужая реализация контракта на другом языке.

const cmd = process.argv[2]
const body = cmd === "describe"
	? { contract: 1, id: "noisy", name: "Noisy", site: "https://noisy.example", capabilities: [], commands: [] }
	: { items: [] }
process.stderr.write("noisy: сайт просил подождать\n")
process.stdout.write(`мусор до\n${JSON.stringify(body)}\nмусор после\n`)
```

`test/fixtures/sleepy.ts` — лежит не в каталоге провайдеров нарочно: он нужен
одному тесту таймаута, а в наборе `odd/` замедлил бы снятие `describe` на все
десять секунд:

```ts
// Никогда не отвечает: на нём проверяется таймаут и SIGTERM.
await new Promise(() => {})
```

`test/fixtures/odd/broken/main.ts`:

```ts
// describe без обязательных полей: такой провайдер в агрегацию не попадает.
process.stdout.write(`${JSON.stringify({ contract: 1, id: "broken" })}\n`)
```

- [ ] **Step 3: Тест реестра**

`test/core/registry.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discover, PROVIDERS_DIR_ENV, select, type Provider } from "../../src/core/registry.ts"
import { parseDescribe } from "../../src/core/validate.ts"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "providers")

const provider = (id: string, capabilities: ("reviews" | "garage" | "analogs" | "basket")[] = []): Provider => ({
	id, bin: ["bun", `/x/${id}/main.ts`], source: "dir",
	describe: { contract: 1, id, name: id, site: `https://${id}.example`, capabilities, commands: [] },
})

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
		const found = await discover()
		const ids = found.map(p => p.id)
		expect(ids).toContain("autodoc")
		expect(ids).toContain("armtek")
		const autodoc = found.find(p => p.id === "autodoc")!
		expect(autodoc.bin[0]).toBe("bun")
		expect(autodoc.bin[1]!.endsWith(join("src", "providers", "autodoc", "main.ts"))).toBe(true)
		expect(autodoc.source).toBe("bundled")
	})

	test("adoc-* в PATH становятся провайдерами, встроенный с тем же id побеждает", async () => {
		const dir = await mkdtemp(join(tmpdir(), "adoc-path-"))
		try {
			await writeFile(join(dir, "adoc-ext"), "#!/bin/sh\necho '{}'\n")
			await chmod(join(dir, "adoc-ext"), 0o755)
			await writeFile(join(dir, "adoc-autodoc"), "#!/bin/sh\necho '{}'\n")
			await chmod(join(dir, "adoc-autodoc"), 0o755)
			await writeFile(join(dir, "adoc-noexec"), "не исполняемый")
			const path = process.env.PATH
			process.env.PATH = dir
			try {
				const found = await discover()
				const ext = found.find(p => p.id === "ext")
				expect(ext).toBeDefined()
				expect(ext!.bin).toEqual([join(dir, "adoc-ext")])
				expect(ext!.source).toBe("path")
				expect(found.find(p => p.id === "noexec")).toBeUndefined()
				expect(found.find(p => p.id === "autodoc")!.source).toBe("bundled")
			} finally {
				process.env.PATH = path
			}
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

	test("нет обязательного поля — отказ", () => {
		expect(() => parseDescribe({ contract: 1, id: "a" }, "a")).toThrow("name")
	})

	test("незнакомая capability отбрасывается, а не роняет провайдера", () => {
		const d = parseDescribe({ contract: 1, id: "a", name: "A", site: "s", capabilities: ["basket", "телепортация"], commands: [] }, "a")
		expect(d.capabilities).toEqual(["basket"])
	})
})
```

- [ ] **Step 4: Запустить, убедиться, что падает**

Run: `bun test test/core/registry.test.ts`
Expected: FAIL, `Cannot find module '../../src/core/registry.ts'`.

- [ ] **Step 5: `src/core/validate.ts`**

```ts
// validate.ts — форма ответов провайдера. Провайдер — чужой процесс, возможно
// на другом языке: всё, что от него пришло, проверяется до использования,
// иначе `undefined.map` вылезал бы посреди таблицы. Ошибка — internal с именем
// провайдера: виноват он, а не пользователь.

import { ProviderError } from "../sdk/index.ts"
import { CONTRACT_VERSION } from "../sdk/contract.ts"
import type { Basket, BasketItem, BrandHit, Capability, Car, Command, Describe, Display, Offer, Product, Rating, Review, Reviews, WhoamiResult } from "../sdk/contract.ts"

const CAPABILITIES: Capability[] = ["reviews", "garage", "analogs", "basket"]

const fail = (who: string, what: string): never => {
	throw new ProviderError("internal", `${who}: ${what}`)
}

const obj = (v: unknown, who: string, what: string): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : fail(who, `${what} — не объект`)

const arr = (v: unknown, who: string, what: string): unknown[] =>
	Array.isArray(v) ? v : fail(who, `${what} — не массив`)

const str = (o: Record<string, unknown>, k: string, who: string): string =>
	typeof o[k] === "string" && o[k] !== "" ? o[k] : fail(who, `нет поля ${k}`)

const optStr = (o: Record<string, unknown>, k: string): string | undefined =>
	typeof o[k] === "string" && o[k] !== "" ? o[k] : undefined

const num = (o: Record<string, unknown>, k: string, who: string): number =>
	typeof o[k] === "number" && Number.isFinite(o[k]) ? o[k] : fail(who, `нет числового поля ${k}`)

const optNum = (o: Record<string, unknown>, k: string): number | undefined =>
	typeof o[k] === "number" && Number.isFinite(o[k]) ? o[k] : undefined

const optBool = (o: Record<string, unknown>, k: string): boolean | undefined =>
	typeof o[k] === "boolean" ? o[k] : undefined

const optObj = (o: Record<string, unknown>, k: string): Record<string, unknown> | undefined =>
	o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ? o[k] as Record<string, unknown> : undefined

const optStrings = (o: Record<string, unknown>, k: string): string[] | undefined =>
	Array.isArray(o[k]) ? o[k].filter((x): x is string => typeof x === "string") : undefined

function optRating(o: Record<string, unknown>): Rating | undefined {
	const r = optObj(o, "rating")
	if (!r) return undefined
	const average = optNum(r, "average"), count = optNum(r, "count")
	return average === undefined || count === undefined ? undefined : { average, count }
}

export function parseDescribe(v: unknown, id: string): Describe {
	const who = id
	const o = obj(v, who, "describe")
	if (o.contract !== CONTRACT_VERSION) fail(who, `контракт версии ${String(o.contract)}, а обёртка знает ${CONTRACT_VERSION}`)
	if (str(o, "id", who) !== id) fail(who, `id в describe — «${String(o.id)}», а бинарь зовётся «${id}»`)
	const commands: Command[] = arr(o.commands, who, "commands").map(c => {
		const x = obj(c, who, "команда")
		return { name: str(x, "name", who), usage: str(x, "usage", who), about: optStr(x, "about") ?? "", auth: x.auth === true }
	})
	return {
		contract: CONTRACT_VERSION,
		id,
		name: str(o, "name", who),
		site: str(o, "site", who),
		// Незнакомая capability — это провайдер новее обёртки, а не поломка:
		// молча отбрасываем, всё известное продолжает работать.
		capabilities: arr(o.capabilities, who, "capabilities").filter((c): c is Capability => CAPABILITIES.includes(c as Capability)),
		commands,
	}
}

export function parseDisplay(v: unknown, who: string): Display {
	const o = obj(v, who, "display")
	return { name: str(o, "name", who), ...(optStr(o, "email") ? { email: optStr(o, "email") } : {}), ...(optStr(o, "phone") ? { phone: optStr(o, "phone") } : {}) }
}

export function parseWhoami(v: unknown, who: string): WhoamiResult {
	const o = obj(v, who, "whoami")
	const ok = o.ok === true
	return ok ? { ok, display: parseDisplay(o.display, who) } : { ok: false }
}

const parseBrandHit = (v: unknown, who: string): BrandHit => {
	const o = obj(v, who, "элемент brands")
	return {
		brand: str(o, "brand", who), article: str(o, "article", who),
		...(optStr(o, "name") ? { name: optStr(o, "name") } : {}),
		...(optRating(o) ? { rating: optRating(o) } : {}),
		...(optObj(o, "extra") ? { extra: optObj(o, "extra") } : {}),
	}
}

export const parseBrands = (v: unknown, who: string): BrandHit[] =>
	arr(obj(v, who, "ответ brands").items, who, "items").map(x => parseBrandHit(x, who))

export function parseOffers(v: unknown, who: string): Offer[] {
	return arr(obj(v, who, "ответ offers").items, who, "items").map(x => {
		const o = obj(x, who, "предложение")
		return {
			article: str(o, "article", who), brand: str(o, "brand", who), price: num(o, "price", who),
			currency: "RUB",
			...(optStr(o, "name") ? { name: optStr(o, "name") } : {}),
			...(optNum(o, "quantity") !== undefined ? { quantity: optNum(o, "quantity") } : {}),
			...(optNum(o, "deliveryDays") !== undefined ? { deliveryDays: optNum(o, "deliveryDays") } : {}),
			...(optStr(o, "deliveryDate") ? { deliveryDate: optStr(o, "deliveryDate") } : {}),
			...(optStr(o, "seller") ? { seller: optStr(o, "seller") } : {}),
			...(optRating(o) ? { rating: optRating(o) } : {}),
			...(optStr(o, "url") ? { url: optStr(o, "url") } : {}),
			...(optObj(o, "ref") ? { ref: optObj(o, "ref") } : {}),
			...(optBool(o, "analog") !== undefined ? { analog: optBool(o, "analog") } : {}),
			...(optObj(o, "extra") ? { extra: optObj(o, "extra") } : {}),
		}
	})
}

export function parseProducts(v: unknown, who: string): Product[] {
	return arr(obj(v, who, "ответ search").items, who, "items").map(x => {
		const o = obj(x, who, "товар")
		return {
			article: str(o, "article", who), brand: str(o, "brand", who), name: optStr(o, "name") ?? "",
			...(optNum(o, "price") !== undefined ? { price: optNum(o, "price") } : {}),
			...(optNum(o, "quantity") !== undefined ? { quantity: optNum(o, "quantity") } : {}),
			...(optRating(o) ? { rating: optRating(o) } : {}),
			...(optStr(o, "url") ? { url: optStr(o, "url") } : {}),
			...(optStr(o, "category") ? { category: optStr(o, "category") } : {}),
			...(optObj(o, "extra") ? { extra: optObj(o, "extra") } : {}),
		}
	})
}

export function parseReviews(v: unknown, who: string): Reviews {
	const o = obj(v, who, "ответ reviews")
	const r = optObj(o, "rating")
	const items: Review[] = arr(o.items, who, "items").map(x => {
		const it = obj(x, who, "отзыв")
		return {
			text: optStr(it, "text") ?? "",
			...(optStr(it, "author") ? { author: optStr(it, "author") } : {}),
			...(optStr(it, "date") ? { date: optStr(it, "date") } : {}),
			...(optNum(it, "rating") !== undefined ? { rating: optNum(it, "rating") } : {}),
			...(optStr(it, "pros") ? { pros: optStr(it, "pros") } : {}),
			...(optStr(it, "cons") ? { cons: optStr(it, "cons") } : {}),
			...(optBool(it, "purchased") !== undefined ? { purchased: optBool(it, "purchased") } : {}),
		}
	})
	const rating = r && optNum(r, "average") !== undefined && optNum(r, "count") !== undefined
		? { average: optNum(r, "average")!, count: optNum(r, "count")!, ...(Array.isArray(r.histogram) ? { histogram: r.histogram.filter((n): n is number => typeof n === "number") } : {}) }
		: undefined
	const summary = optObj(o, "summary")
	return {
		total: optNum(o, "total") ?? items.length,
		...(rating ? { rating } : {}),
		...(summary ? { summary: { pros: optStrings(summary, "pros") ?? [], cons: optStrings(summary, "cons") ?? [] } } : {}),
		items,
	}
}

export function parseBasket(v: unknown, who: string): Basket {
	const o = obj(v, who, "корзина")
	const items: BasketItem[] = arr(o.items, who, "items").map(x => {
		const it = obj(x, who, "позиция корзины")
		return {
			id: str(it, "id", who), article: str(it, "article", who), brand: str(it, "brand", who),
			price: num(it, "price", who), quantity: num(it, "quantity", who),
			...(optStr(it, "name") ? { name: optStr(it, "name") } : {}),
			...(optNum(it, "sum") !== undefined ? { sum: optNum(it, "sum") } : {}),
			...(optStr(it, "seller") ? { seller: optStr(it, "seller") } : {}),
			...(optNum(it, "deliveryDays") !== undefined ? { deliveryDays: optNum(it, "deliveryDays") } : {}),
			...(optStr(it, "deliveryDate") ? { deliveryDate: optStr(it, "deliveryDate") } : {}),
		}
	})
	return { items, currency: "RUB", ...(optNum(o, "total") !== undefined ? { total: optNum(o, "total") } : {}), ...(optStr(o, "url") ? { url: optStr(o, "url") } : {}) }
}

export function parseCars(v: unknown, who: string): Car[] {
	return arr(obj(v, who, "ответ garage export").cars, who, "cars").map(x => {
		const c = obj(x, who, "машина")
		return {
			brand: str(c, "brand", who), model: str(c, "model", who), ref: optObj(c, "ref") ?? {},
			...(optStr(c, "modification") ? { modification: optStr(c, "modification") } : {}),
			...(optNum(c, "year") !== undefined ? { year: optNum(c, "year") } : {}),
			...(optStr(c, "engine") ? { engine: optStr(c, "engine") } : {}),
			...(optStr(c, "vin") ? { vin: optStr(c, "vin") } : {}),
			...(optNum(c, "odometer") !== undefined ? { odometer: optNum(c, "odometer") } : {}),
		}
	})
}
```

- [ ] **Step 6: `src/core/registry.ts` — обнаружение и выбор**

```ts
// registry.ts — какие провайдеры есть. Встроенные ищутся по пути относительно
// самого агрегатора, чтобы он работал и без глобальной установки; внешние —
// исполняемые adoc-* в PATH, на любом языке. ADOC_PROVIDERS_DIR подменяет
// весь набор целиком: так тесты гоняют фикстуры и никогда не трогают ни
// настоящих провайдеров, ни сеть.

import { access, readdir } from "node:fs/promises"
import { constants } from "node:fs"
import { delimiter, join } from "node:path"
import { ProviderError, TOOL, type Flags } from "../sdk/index.ts"
import type { Capability, Describe } from "../sdk/contract.ts"

export const PROVIDERS_DIR_ENV = `${TOOL.toUpperCase()}_PROVIDERS_DIR`

export type ProviderEntry = {
	id: string
	/** Команда запуска целиком: ["bun", "/путь/main.ts"] или ["/usr/bin/adoc-armtek"]. */
	bin: string[]
	source: "bundled" | "path" | "dir"
}

export type Provider = ProviderEntry & { describe: Describe }
export type BadProvider = ProviderEntry & { message: string }
export type Loaded = { ok: Provider[]; bad: BadProvider[] }

const readable = async (path: string): Promise<boolean> => {
	try { await access(path, constants.R_OK); return true } catch { return false }
}

const executable = async (path: string): Promise<boolean> => {
	try { await access(path, constants.X_OK); return true } catch { return false }
}

async function fromDir(dir: string, source: ProviderEntry["source"]): Promise<ProviderEntry[]> {
	let names: string[]
	try { names = await readdir(dir) } catch { return [] }
	const out: ProviderEntry[] = []
	for (const name of names.sort()) {
		const main = join(dir, name, "main.ts")
		if (await readable(main)) out.push({ id: name, bin: ["bun", main], source })
	}
	return out
}

async function fromPath(): Promise<ProviderEntry[]> {
	const prefix = `${TOOL}-`
	const out: ProviderEntry[] = []
	const seen = new Set<string>()
	for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
		let names: string[]
		try { names = await readdir(dir) } catch { continue }
		for (const name of names.sort()) {
			if (!name.startsWith(prefix) || name.length === prefix.length) continue
			const id = name.slice(prefix.length)
			if (seen.has(id)) continue // первый в PATH побеждает, как у самой оболочки
			const file = join(dir, name)
			if (!(await executable(file))) continue
			seen.add(id)
			out.push({ id, bin: [file], source: "path" })
		}
	}
	return out
}

export async function discover(): Promise<ProviderEntry[]> {
	const forced = process.env[PROVIDERS_DIR_ENV]
	if (forced) return await fromDir(forced, "dir")

	// import.meta.dir — src/core, значит соседний src/providers. Путь считается
	// от файла, а не от cwd: агрегатор запускают откуда угодно.
	const bundled = await fromDir(join(import.meta.dir, "..", "providers"), "bundled")
	const ids = new Set(bundled.map(p => p.id))
	const external = (await fromPath()).filter(p => !ids.has(p.id))
	return [...bundled, ...external].sort((a, b) => a.id.localeCompare(b.id))
}

const list = (v: string | true | undefined): string[] =>
	typeof v === "string" ? v.split(",").map(s => s.trim()).filter(Boolean) : []

/** `--only`/`--providers`, `--skip` и фильтр по capability. */
export function select(ok: Provider[], flags: Flags, cap?: Capability): Provider[] {
	const known = new Set(ok.map(p => p.id))
	const check = (ids: string[], flag: string): string[] => {
		for (const id of ids) if (!known.has(id)) throw new ProviderError("bad_args", `--${flag}: нет провайдера «${id}» — есть ${[...known].join(", ") || "ни одного"}`)
		return ids
	}
	// --providers — синоним --only: так эту мысль чаще всего и записывают.
	const only = check([...list(flags.only), ...list(flags.providers)], flags.only !== undefined ? "only" : "providers")
	const skip = new Set(check(list(flags.skip), "skip"))

	let out = ok.filter(p => (only.length ? only.includes(p.id) : true) && !skip.has(p.id))
	if (cap) out = out.filter(p => p.describe.capabilities.includes(cap))
	if (!out.length) {
		throw new ProviderError("bad_args", cap
			? `ни один выбранный провайдер не умеет ${cap} — смотри ${TOOL} providers`
			: `не осталось ни одного провайдера — смотри ${TOOL} providers`)
	}
	return out
}
```

- [ ] **Step 7: Зелёные тесты**

Run: `bun test test/core/registry.test.ts && bun run typecheck`
Expected: PASS, 14 тестов.

- [ ] **Step 8: Commit**

```bash
git add src/core/registry.ts src/core/validate.ts test/core/registry.test.ts test/fixtures/fake test/fixtures/providers test/fixtures/odd test/fixtures/sleepy.ts
git commit -m "feat(core): provider discovery, describe validation and fake providers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Вызов провайдера

**Files:**
- Create: `src/core/invoke.ts`
- Modify: `src/core/registry.ts` (добавить `load()`)
- Test: `test/core/invoke.test.ts`

**Interfaces:**
- Consumes: `discover()`, `ProviderEntry`, `parseDescribe(v, id)`, `configDir()`, `CONFIG_DIR_ENV`.
- Produces: `INVOKE_TIMEOUT_MS = 30_000`; типы `InvokeError = {code: ErrorCode; message: string; items?: BrandHit[]}`, `InvokeResult = {ok: true; json: unknown; stderr: string; warnings: string[]} | {ok: false; error: InvokeError; stderr: string; warnings: string[]}`; `invoke(bin: string[], args: string[], opts?: {timeoutMs?: number; interactive?: boolean}): Promise<InvokeResult>`; `load(): Promise<Loaded>` в `registry.ts`.

- [ ] **Step 1: Тест**

`test/core/invoke.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { invoke } from "../../src/core/invoke.ts"
import { load, PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "providers")
const ODD = join(import.meta.dir, "..", "fixtures", "odd")
const alpha = ["bun", join(FIXTURES, "alpha", "main.ts")]
const noisy = ["bun", join(ODD, "noisy", "main.ts")]
const sleepy = ["bun", join(import.meta.dir, "..", "fixtures", "sleepy.ts")]

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-invoke-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	await rm(dir, { recursive: true, force: true })
})

describe("invoke", () => {
	test("успешный вызов отдаёт разобранный JSON", async () => {
		const r = await invoke(alpha, ["brands", "n90954802"])
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect((r.json as { items: { brand: string }[] }).items[0]!.brand).toBe("VAG")
	})

	test("--json добавляется сам, ровно один раз", async () => {
		const r = await invoke(alpha, ["hello", "мир"])
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect(r.json).toEqual({ hello: "мир" })
	})

	test("тело ошибки провайдера становится InvokeError", async () => {
		const r = await invoke(alpha, ["basket"])
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("auth")
		expect(r.error.message).toContain("нужен вход")
	})

	test("exit 2 с ambiguous доносит items", async () => {
		const r = await invoke(alpha, ["brands", "N90954802"], { env: { FAKE_ALPHA_AMBIGUOUS: "1" } })
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("ambiguous")
		expect(r.error.items).toHaveLength(2)
	})

	test("мусор вокруг JSON отбрасывается с предупреждением, stderr доносится", async () => {
		const r = await invoke(noisy, ["brands", "N1"])
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect(r.json).toEqual({ items: [] })
		expect(r.warnings.join(" ")).toContain("не только JSON")
		expect(r.stderr).toContain("сайт просил подождать")
	})

	test("таймаут: провайдер убит, код timeout", async () => {
		const started = Date.now()
		const r = await invoke(sleepy, ["brands", "N1"], { timeoutMs: 300 })
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("timeout")
		expect(Date.now() - started).toBeLessThan(5_000)
	})

	test("провайдер молча вышел с ненулевым кодом — internal", async () => {
		const r = await invoke(["sh", "-c", "exit 3"], ["brands"])
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("internal")
		expect(r.error.message).toContain("3")
	})

	test("пустой stdout при exit 0 — internal, а не тихий успех", async () => {
		const r = await invoke(["sh", "-c", "exit 0"], ["brands"])
		expect(r.ok).toBe(false)
		if (r.ok) return
		expect(r.error.code).toBe("internal")
	})

	test("ADOC_CONFIG_DIR уезжает ребёнку", async () => {
		const r = await invoke(["sh", "-c", `printf '{"dir":"%s"}' "$${CONFIG_DIR_ENV}"`], [])
		expect(r.ok).toBe(true)
		if (!r.ok) return
		expect((r.json as { dir: string }).dir).toBe(dir)
	})
})

describe("load", () => {
	test("describe снимается со всех, битый уезжает в bad", async () => {
		process.env[PROVIDERS_DIR_ENV] = FIXTURES
		const { ok, bad } = await load()
		expect(ok.map(p => p.id)).toEqual(["alpha", "beta"])
		expect(ok[0]!.describe.capabilities).toContain("basket")
		expect(bad).toEqual([])
	})

	test("провайдер с битым describe в агрегацию не попадает", async () => {
		process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "odd")
		const { ok, bad } = await load()
		expect(ok.map(p => p.id)).toEqual(["noisy"])
		expect(bad.map(b => b.id)).toEqual(["broken"])
		expect(bad.find(b => b.id === "broken")!.message).toContain("name")
	})
})
```

Тесту нужен `opts.env` — вторая причина, кроме таймаута, по которой у `invoke` есть опции.

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/core/invoke.test.ts`
Expected: FAIL, `Cannot find module '../../src/core/invoke.ts'`.

- [ ] **Step 3: `src/core/invoke.ts`**

```ts
// invoke.ts — единственный способ поговорить с провайдером: запустить его
// процессом и прочитать один JSON-объект из stdout. Ни импортов провайдера,
// ни общей памяти: чужая реализация контракта может быть на любом языке.

import { CONFIG_DIR_ENV, configDir } from "../sdk/config.ts"
import type { BrandHit, ErrorCode } from "../sdk/contract.ts"

/** Столько ждём ответа. Дальше SIGTERM: висящий сайт не должен вешать выдачу. */
export const INVOKE_TIMEOUT_MS = 30_000

const CODES = new Set<string>(["auth", "http", "notfound", "tty", "timeout", "bad_args", "internal", "ambiguous"])

export type InvokeError = { code: ErrorCode; message: string; items?: BrandHit[] }

export type InvokeResult =
	| { ok: true; json: unknown; stderr: string; warnings: string[] }
	| { ok: false; error: InvokeError; stderr: string; warnings: string[] }

export type InvokeOpts = {
	timeoutMs?: number
	/** login: stdin и подсказки идут прямо в терминал, stdout всё равно наш. */
	interactive?: boolean
	/** Дополнительные переменные окружения — нужны тестам и только им. */
	env?: Record<string, string>
}

export async function invoke(bin: string[], args: string[], opts: InvokeOpts = {}): Promise<InvokeResult> {
	const timeoutMs = opts.timeoutMs ?? INVOKE_TIMEOUT_MS
	const warnings: string[] = []

	const proc = Bun.spawn([...bin, ...args, "--json"], {
		// Каталог конфига передаём явно: ребёнок обязан писать свой аккаунт
		// туда же, куда смотрит обёртка, даже если у него другое окружение.
		env: { ...process.env, [CONFIG_DIR_ENV]: configDir(), ...opts.env },
		stdin: opts.interactive ? "inherit" : "ignore",
		stdout: "pipe",
		stderr: "pipe",
	})

	let timedOut = false
	const timer = setTimeout(() => { timedOut = true; proc.kill("SIGTERM") }, timeoutMs)
	let out = "", err = ""
	try {
		;[out, err] = await Promise.all([
			new Response(proc.stdout).text(),
			opts.interactive ? pump(proc.stderr) : new Response(proc.stderr).text(),
		])
		await proc.exited
	} finally {
		clearTimeout(timer)
	}

	if (timedOut) return { ok: false, error: { code: "timeout", message: `нет ответа за ${timeoutMs} мс` }, stderr: err, warnings }

	const code = proc.exitCode ?? 1
	const body = extractJson(out, warnings)
	const failure = errorOf(body)
	// Тело важнее кода: провайдер объяснил, что случилось, своими словами.
	if (failure) return { ok: false, error: failure, stderr: err, warnings }
	if (code !== 0) {
		const tail = err.trim().split("\n").pop() ?? ""
		return { ok: false, error: { code: code === 2 ? "ambiguous" : "internal", message: `провайдер вышел с кодом ${code}${tail ? `: ${tail}` : ""}` }, stderr: err, warnings }
	}
	if (body === undefined) return { ok: false, error: { code: "internal", message: "провайдер не отдал JSON в stdout" }, stderr: err, warnings }
	return { ok: true, json: body, stderr: err, warnings }
}

// В интерактивном режиме подсказки провайдера должны появляться сразу, а не
// после того, как пользователь вслепую введёт пароль.
async function pump(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader()
	for (;;) {
		const { done, value } = await reader.read()
		if (done) return ""
		process.stderr.write(value)
	}
}

/**
 * Контракт требует в stdout ровно один объект, но чужая реализация нет-нет да
 * и напечатает лишнее. Берём кусок от первой `{` до последней `}` и честно
 * говорим, что что-то отбросили: молчаливое исправление чужих багов кончается
 * тем, что их никто не чинит.
 */
function extractJson(out: string, warnings: string[]): unknown {
	const start = out.indexOf("{")
	const end = out.lastIndexOf("}")
	if (start < 0 || end < start) return undefined
	if (start > 0 || end < out.trimEnd().length - 1) warnings.push("провайдер печатал в stdout не только JSON — лишнее отброшено")
	try {
		return JSON.parse(out.slice(start, end + 1))
	} catch {
		return undefined
	}
}

function errorOf(body: unknown): InvokeError | null {
	if (!body || typeof body !== "object") return null
	const e = (body as { error?: unknown }).error
	if (!e || typeof e !== "object") return null
	const { code, message, items } = e as { code?: unknown; message?: unknown; items?: unknown }
	return {
		code: typeof code === "string" && CODES.has(code) ? code as ErrorCode : "internal",
		message: typeof message === "string" && message ? message : "провайдер не объяснил ошибку",
		...(Array.isArray(items) ? { items: items as BrandHit[] } : {}),
	}
}
```

- [ ] **Step 4: `load()` в `src/core/registry.ts`**

Добавить импорты и функцию в конец файла:

```ts
import { invoke } from "./invoke.ts"
import { parseDescribe } from "./validate.ts"

/**
 * describe у всех найденных провайдеров параллельно. Ответ кэшируется на
 * запуск (кэшем владеет app.ts), но не на диск: список команд провайдера
 * меняется вместе с его версией, а протухший кэш врал бы в справке.
 * Таймаут короче общего: describe обязан работать без сети.
 */
export async function load(): Promise<Loaded> {
	const entries = await discover()
	const settled = await Promise.all(entries.map(async (e): Promise<Provider | BadProvider> => {
		const r = await invoke(e.bin, ["describe"], { timeoutMs: 10_000 })
		if (!r.ok) return { ...e, message: r.error.message }
		try {
			return { ...e, describe: parseDescribe(r.json, e.id) }
		} catch (err) {
			return { ...e, message: err instanceof Error ? err.message : String(err) }
		}
	}))
	return {
		ok: settled.filter((p): p is Provider => "describe" in p),
		bad: settled.filter((p): p is BadProvider => "message" in p),
	}
}
```

- [ ] **Step 5: Зелёные тесты**

Run: `bun test test/core/invoke.test.ts && bun run typecheck`
Expected: PASS, 11 тестов. Тест про таймаут занимает около 0.3 с — если он тянет секунды, значит `SIGTERM` не доходит.

- [ ] **Step 6: Commit**

```bash
git add src/core/invoke.ts src/core/registry.ts test/core/invoke.test.ts
git commit -m "feat(core): spawn providers, timeout, json extraction and describe cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 5: Частичный отказ и таблицы агрегатора

**Files:**
- Create: `src/core/partial.ts`
- Create: `src/core/render.ts`
- Test: `test/core/partial.test.ts`

**Interfaces:**
- Consumes: `InvokeResult` из `invoke.ts`, `Provider`/`BadProvider` из `registry.ts`, `table`/`ratingCell`/`qtyCell`/цвета из `src/sdk/render.ts`.
- Produces: типы `Failure = {provider: string; code: ErrorCode; message: string}`, `Got<T> = {provider: string; value: T}`, `Fanout<T> = {got: Got<T>[]; failures: Failure[]; asked: number}`; `fanout(providers, call, parse, warn)`, `passNoise(id, r, warn)`, `failureLine(f)`, `allFailed(f)`, `report(f, extra, warn): 0 | 1`; `providersTable(ok, bad, accounts)`, `accountsTable(rows)`, тип `AccountRow`.

- [ ] **Step 1: Тест**

`test/core/partial.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { allFailed, failureLine, fanout, report, type Failure } from "../../src/core/partial.ts"
import type { InvokeResult } from "../../src/core/invoke.ts"
import type { Provider } from "../../src/core/registry.ts"

const provider = (id: string): Provider => ({
	id, bin: ["bun", `/x/${id}`], source: "dir",
	describe: { contract: 1, id, name: id, site: "https://x", capabilities: [], commands: [] },
})

const ok = (json: unknown, stderr = "", warnings: string[] = []): InvokeResult => ({ ok: true, json, stderr, warnings })
const bad = (code: Failure["code"], message: string): InvokeResult => ({ ok: false, error: { code, message }, stderr: "", warnings: [] })

const items = (json: unknown): number[] => (json as { items: number[] }).items

describe("fanout", () => {
	test("ответы и отказы разъезжаются по своим спискам", async () => {
		const lines: string[] = []
		const f = await fanout(
			[provider("alpha"), provider("beta")],
			async p => (p.id === "alpha" ? ok({ items: [1] }) : bad("auth", "нужен вход")),
			items,
			l => lines.push(l),
		)
		expect(f.got).toEqual([{ provider: "alpha", value: [1] }])
		expect(f.failures).toEqual([{ provider: "beta", code: "auth", message: "нужен вход" }])
		expect(f.asked).toBe(2)
	})

	test("сломанная форма ответа — отказ этого провайдера, а не всей команды", async () => {
		const f = await fanout([provider("alpha")], async () => ok({ нет: "items" }), j => {
			const v = (j as { items?: unknown }).items
			if (!Array.isArray(v)) throw new Error("нет items")
			return v
		}, () => {})
		expect(f.got).toEqual([])
		expect(f.failures[0]!.code).toBe("internal")
		expect(f.failures[0]!.message).toContain("items")
	})

	test("исключение при самом вызове тоже становится отказом", async () => {
		const f = await fanout([provider("alpha")], async () => { throw new Error("spawn упал") }, items, () => {})
		expect(f.failures[0]!.message).toBe("spawn упал")
	})

	test("stderr провайдера уходит наружу как есть, наши замечания — с префиксом", async () => {
		const lines: string[] = []
		await fanout([provider("alpha")], async () => ok({ items: [] }, "сайт устал\n", ["лишнее в stdout"]), items, l => lines.push(l))
		expect(lines[0]).toBe("сайт устал")
		expect(lines[1]).toContain("adoc: alpha: лишнее в stdout")
	})
})

describe("отчёт об отказах", () => {
	test("auth превращается в подсказку про login", () => {
		expect(failureLine({ provider: "armtek", code: "auth", message: "401" })).toContain("adoc login armtek")
	})

	test("остальные коды печатают сообщение провайдера", () => {
		expect(failureLine({ provider: "armtek", code: "http", message: "HTTP 500" })).toContain("HTTP 500")
	})

	test("упали все — код 1; ответил хоть кто-то — 0", () => {
		const lines: string[] = []
		const none = { got: [], failures: [{ provider: "a", code: "http" as const, message: "x" }], asked: 1 }
		expect(allFailed(none)).toBe(true)
		expect(report(none, [], l => lines.push(l))).toBe(1)
		expect(lines).toHaveLength(1)
		expect(report({ got: [{ provider: "a", value: 1 }], failures: [], asked: 1 }, [], () => {})).toBe(0)
	})

	test("никого не спрашивали — это не отказ", () => {
		expect(allFailed({ got: [], failures: [], asked: 0 })).toBe(false)
	})
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/core/partial.test.ts`
Expected: FAIL, `Cannot find module '../../src/core/partial.ts'`.

- [ ] **Step 3: `src/core/partial.ts`**

```ts
// partial.ts — модель частичного отказа. Один сайт лежит, второй отвечает:
// показать второй и честно сказать про первый лучше, чем не показать ничего.
// Отказ не прячется — жёлтая строка в stderr и поле errors в --json.

import { TOOL } from "../sdk/config.ts"
import { yellow } from "../sdk/render.ts"
import type { ErrorCode } from "../sdk/contract.ts"
import type { InvokeResult } from "./invoke.ts"
import type { Provider } from "./registry.ts"

export type Failure = { provider: string; code: ErrorCode; message: string }
export type Got<T> = { provider: string; value: T }
export type Fanout<T> = { got: Got<T>[]; failures: Failure[]; asked: number }

/** Разговор провайдера с человеком: его stderr — как есть, наши замечания — подписанными. */
export function passNoise(id: string, r: InvokeResult, warn: (line: string) => void): void {
	if (r.stderr.trim()) warn(r.stderr.replace(/\n+$/, ""))
	for (const w of r.warnings) warn(yellow(`${TOOL}: ${id}: ${w}`))
}

const asFailure = (provider: string, e: unknown): Failure =>
	({ provider, code: "internal", message: e instanceof Error ? e.message : String(e) })

/**
 * Один и тот же вопрос всем провайдерам сразу. Ошибка любого рода — отказ
 * этого провайдера: try/catch внутри задачи делает то же, что Promise.allSettled,
 * но сразу в нужной форме.
 */
export async function fanout<T>(
	providers: Provider[],
	call: (p: Provider) => Promise<InvokeResult>,
	parse: (json: unknown, provider: string) => T,
	warn: (line: string) => void,
): Promise<Fanout<T>> {
	const settled = await Promise.all(providers.map(async (p): Promise<Got<T> | Failure> => {
		let r: InvokeResult
		try {
			r = await call(p)
		} catch (e) {
			return asFailure(p.id, e)
		}
		passNoise(p.id, r, warn)
		if (!r.ok) return { provider: p.id, code: r.error.code, message: r.error.message }
		try {
			return { provider: p.id, value: parse(r.json, p.id) }
		} catch (e) {
			return asFailure(p.id, e)
		}
	}))
	return {
		got: settled.filter((x): x is Got<T> => "value" in x),
		failures: settled.filter((x): x is Failure => "code" in x),
		asked: providers.length,
	}
}

export const failureLine = (f: Failure): string =>
	yellow(`${f.provider}: ${f.code === "auth" ? `нужен вход — ${TOOL} login ${f.provider}` : f.message}`)

/** Не ответил никто из тех, кого спрашивали. Спрашивать было некого — не отказ. */
export const allFailed = (f: Fanout<unknown>): boolean => f.asked > 0 && f.got.length === 0

/**
 * Жёлтые строки в stderr и код возврата. `extra` — отказы предыдущего шага
 * (например, шага брендов у `part`): их тоже показываем, но на код возврата
 * влияет только последний вопрос — если на него ответил хоть кто-то, выдача есть.
 */
export function report(f: Fanout<unknown>, extra: Failure[], warn: (line: string) => void): 0 | 1 {
	for (const x of [...extra, ...f.failures]) warn(failureLine(x))
	return allFailed(f) ? 1 : 0
}
```

- [ ] **Step 4: `src/core/render.ts`**

```ts
// render.ts — таблицы агрегатора. Примитивы (table, money, days, звёзды,
// цвета, ячейки рейтинга и наличия) берутся из sdk/render.ts: у обёртки и у
// провайдера одни и те же колонки должны выглядеть одинаково.

import { TOOL } from "../sdk/config.ts"
import { bold, dim, green, qtyCell, ratingCell, red, table, yellow } from "../sdk/render.ts"
import type { Display } from "../sdk/contract.ts"
import type { BadProvider, Provider } from "./registry.ts"

export { qtyCell, ratingCell }

/** Подсказка под таблицей: что делать дальше. */
export const hint = (s: string): string => dim(s)

export function providersTable(ok: Provider[], bad: BadProvider[], accounts: Set<string>): string {
	if (!ok.length && !bad.length) return `провайдеров не нашлось: положи исполняемый ${TOOL}-<id> в PATH`
	const rows = ok.map(p => [
		bold(p.id), p.describe.name, String(p.describe.contract),
		p.describe.capabilities.join(", ") || dim("—"),
		accounts.has(p.id) ? green("есть") : dim("нет"),
		dim(p.bin.join(" ")),
	])
	for (const b of bad) rows.push([red(b.id), red(b.message), dim("—"), dim("—"), dim("—"), dim(b.bin.join(" "))])
	return table(rows, ["ID", "ИМЯ", "КОНТРАКТ", "УМЕЕТ", "АККАУНТ", "ЧЕМ ЗАПУСКАЕТСЯ"])
}

export type AccountRow = { provider: string; ok: boolean; display?: Display; note?: string }

/**
 * Имя, почта и телефон печатаются как отдал сайт, без маскировки: это личные
 * данные самого пользователя, он их и видит. Дальше терминала они не идут.
 */
export function accountsTable(rows: AccountRow[]): string {
	if (!rows.length) return "аккаунтов нет"
	return table(rows.map(r => [
		bold(r.provider),
		r.note ? yellow(r.note) : r.ok ? green("вход есть") : dim("входа нет"),
		r.display?.name ?? dim("—"), r.display?.email ?? dim("—"), r.display?.phone ?? dim("—"),
	]), ["ПРОВАЙДЕР", "СТАТУС", "ИМЯ", "EMAIL", "ТЕЛЕФОН"])
}
```

- [ ] **Step 5: Зелёные тесты**

Run: `bun test test/core/partial.test.ts && bun run typecheck`
Expected: PASS, 8 тестов.

- [ ] **Step 6: Commit**

```bash
git add src/core/partial.ts src/core/render.ts test/core/partial.test.ts
git commit -m "feat(core): partial failure model and aggregator tables

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `providers`, `accounts`/`whoami`, `login`, `logout`

**Files:**
- Create: `src/core/ctx.ts`
- Create: `src/core/args.ts`
- Create: `src/commands/providers.ts`
- Create: `src/commands/accounts.ts`
- Modify: `src/app.ts` (реальные `load`/`pick`, таблица команд)
- Test: `test/commands/providers.test.ts`
- Test: `test/commands/accounts.test.ts`

**Interfaces:**
- Consumes: `load()`, `select()`, `invoke()`, `fanout()`, `passNoise()`, `parseWhoami`, `parseDisplay`, `listAccountIds()`, `removeAccount()`, `providersTable`, `accountsTable`.
- Produces: типы `Ctx` и `Output`; `need(v, what)`, `limitOf(flags, def?)`, `pageOf(flags)`, `qtyOf(flags)`, `refOf(flags)`, `one(ctx, id, cap?)`; `cmdProviders`, `cmdAccounts`, `cmdLogin`, `cmdLogout` — все типа `(ctx: Ctx) => Promise<Output>`.

- [ ] **Step 1: Тесты**

`test/commands/providers.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { accountStore } from "../../src/sdk/account.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "providers")

let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-cmd-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = FIXTURES
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	await rm(dir, { recursive: true, force: true })
})

describe("adoc providers", () => {
	test("таблица со всеми найденными", async () => {
		const r = await run(["providers"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("alpha")
		expect(r.stdout).toContain("beta")
		expect(r.stdout).toContain("basket")
	})

	test("--json отдаёт id, capabilities и чем запускается", async () => {
		const r = await run(["providers", "--json"])
		const j = JSON.parse(r.stdout) as { providers: { id: string; capabilities: string[]; account: boolean; bin: string }[] }
		expect(j.providers.map(p => p.id)).toEqual(["alpha", "beta"])
		expect(j.providers[0]!.capabilities).toContain("reviews")
		expect(j.providers[0]!.account).toBe(false)
		expect(j.providers[0]!.bin).toContain("alpha")
	})

	test("аккаунт виден по файлу, без единого вызова сайта", async () => {
		await accountStore("alpha").save({ token: "t", user: "pavel" })
		const j = JSON.parse((await run(["providers", "--json"])).stdout) as { providers: { id: string; account: boolean }[] }
		expect(j.providers.find(p => p.id === "alpha")!.account).toBe(true)
	})

	test("битый провайдер попадает в broken, а не в providers", async () => {
		process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "odd")
		const j = JSON.parse((await run(["providers", "--json"])).stdout) as { providers: { id: string }[]; broken: { id: string; message: string }[] }
		expect(j.providers.map(p => p.id)).toEqual(["noisy"])
		expect(j.broken[0]!.id).toBe("broken")
	})
})
```

`test/commands/accounts.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { accountStore } from "../../src/sdk/account.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"

const FIXTURES = join(import.meta.dir, "..", "fixtures", "providers")

let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-acc-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = FIXTURES
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_LOGIN
	delete process.env.FAKE_ALPHA_PASSWORD
	await rm(dir, { recursive: true, force: true })
})

describe("adoc accounts", () => {
	test("без входа — ok:false у всех, код 0", async () => {
		const r = await run(["accounts", "--json"])
		expect(r.code).toBe(0)
		const j = JSON.parse(r.stdout) as { accounts: { provider: string; ok: boolean }[] }
		expect(j.accounts).toEqual([{ provider: "alpha", ok: false }, { provider: "beta", ok: false }])
	})

	test("с аккаунтом — display от провайдера", async () => {
		await accountStore("alpha").save({ token: "t", user: "pavel" })
		const j = JSON.parse((await run(["accounts", "--json"])).stdout) as { accounts: { provider: string; ok: boolean; display?: { name: string } }[] }
		expect(j.accounts.find(a => a.provider === "alpha")).toEqual({ provider: "alpha", ok: true, display: { name: "pavel", email: "pavel@alpha.example" } })
	})

	test("whoami — то же самое", async () => {
		expect(JSON.parse((await run(["whoami", "--json"])).stdout)).toEqual(JSON.parse((await run(["accounts", "--json"])).stdout))
	})

	test("аккаунт без провайдера виден отдельной строкой", async () => {
		await accountStore("призрак").save({ token: "t" })
		const j = JSON.parse((await run(["accounts", "--json"])).stdout) as { orphans: string[] }
		expect(j.orphans).toEqual(["призрак"])
	})

	test("таблица для человека маскировкой не занимается", async () => {
		await accountStore("alpha").save({ token: "t", user: "pavel" })
		const r = await run(["accounts"])
		expect(r.stdout).toContain("pavel@alpha.example")
	})
})

describe("adoc login / logout", () => {
	test("login делегирует провайдеру и не печатает токен", async () => {
		process.env.FAKE_ALPHA_LOGIN = "pavel"
		process.env.FAKE_ALPHA_PASSWORD = "pw"
		const r = await run(["login", "alpha", "--json"])
		expect(r.code).toBe(0)
		expect(r.stdout).not.toContain("t-pavel")
		expect(JSON.parse(r.stdout)).toEqual({ ok: true, provider: "alpha", display: { name: "pavel", email: "pavel@alpha.example" } })
		expect(await accountStore("alpha").load()).toEqual({ token: "t-pavel", user: "pavel" })
	})

	test("неверный пароль — код 1 и текст провайдера", async () => {
		process.env.FAKE_ALPHA_LOGIN = "pavel"
		process.env.FAKE_ALPHA_PASSWORD = "не тот"
		const r = await run(["login", "alpha", "--json"])
		expect(r.code).toBe(1)
		expect(JSON.parse(r.stdout).error.code).toBe("auth")
	})

	test("login без имени провайдера — bad_args", async () => {
		expect((await run(["login", "--json"])).code).toBe(1)
		expect(JSON.parse((await run(["login", "--json"])).stdout).error.code).toBe("bad_args")
	})

	test("login чужого провайдера — bad_args с перечислением", async () => {
		const r = await run(["login", "гамма", "--json"])
		expect(JSON.parse(r.stdout).error.message).toContain("alpha")
	})

	test("logout удаляет файл аккаунта и говорит, был ли он", async () => {
		await accountStore("alpha").save({ token: "t", user: "pavel" })
		expect(JSON.parse((await run(["logout", "alpha", "--json"])).stdout)).toEqual({ ok: true, provider: "alpha", had: true })
		expect(await accountStore("alpha").load()).toBeNull()
		expect(JSON.parse((await run(["logout", "alpha", "--json"])).stdout).had).toBe(false)
	})

	test("logout забирает и осиротевший файл, провайдера для которого больше нет", async () => {
		await accountStore("призрак").save({ token: "t" })
		expect(JSON.parse((await run(["logout", "призрак", "--json"])).stdout)).toEqual({ ok: true, provider: "призрак", had: true })
	})
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/commands`
Expected: FAIL — `неизвестная команда: providers`.

- [ ] **Step 3: `src/core/args.ts`**

```ts
// args.ts — аргументы команд обёртки. Числа, JSON и имена провайдеров
// проверяются здесь, чтобы пользователь получил bad_args с внятным текстом,
// а не падение посреди выдачи.

import { ProviderError, TOOL, positiveInt, type Flags } from "../sdk/index.ts"
import type { Capability } from "../sdk/contract.ts"
import type { Ctx } from "./ctx.ts"
import type { Provider } from "./registry.ts"

export function need(v: string | undefined, what: string): string {
	if (!v) throw new ProviderError("bad_args", `нужен ${what}`)
	return v
}

export const limitOf = (flags: Flags, def = 10): number => (flags.limit === undefined ? def : positiveInt("--limit", flags.limit))
export const pageOf = (flags: Flags): number => (flags.page === undefined ? 1 : positiveInt("--page", flags.page))
export const qtyOf = (flags: Flags): number => (flags.qty === undefined ? 1 : positiveInt("--qty", flags.qty))

/** `--ref` — непрозрачный объект из выдачи `part`; обёртка его не толкует. */
export function refOf(flags: Flags): Record<string, unknown> {
	if (typeof flags.ref !== "string" || !flags.ref) throw new ProviderError("bad_args", `нужен --ref <json> из выдачи ${TOOL} part --json`)
	try {
		const o = JSON.parse(flags.ref) as unknown
		if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error()
		return o as Record<string, unknown>
	} catch {
		throw new ProviderError("bad_args", "--ref должен быть JSON-объектом")
	}
}

/** Один провайдер по имени: для login/logout и адресных команд корзины. */
export async function one(ctx: Ctx, id: string | undefined, cap?: Capability): Promise<Provider> {
	const name = need(id, `имя провайдера — список: ${TOOL} providers`)
	const { ok } = await ctx.load()
	const p = ok.find(x => x.id === name)
	if (!p) throw new ProviderError("bad_args", `нет провайдера «${name}» — есть ${ok.map(x => x.id).join(", ") || "ни одного"}`)
	if (cap && !p.describe.capabilities.includes(cap)) throw new ProviderError("bad_args", `${name} не умеет ${cap}`)
	return p
}
```

- [ ] **Step 4: `src/commands/providers.ts`**

```ts
// providers.ts — что подключено. Единственная команда, которая показывает и
// сломанных провайдеров: остальным они не видны, в агрегацию не попадают.
// Статус аккаунта берётся по наличию файла, а не вызовом whoami: список
// провайдеров должен печататься мгновенно и без сети.

import { listAccountIds } from "../core/store.ts"
import { providersTable } from "../core/render.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdProviders(ctx: Ctx): Promise<Output> {
	const { ok, bad } = await ctx.load()
	const accounts = new Set(await listAccountIds())
	const json = {
		providers: ok.map(p => ({
			id: p.id, name: p.describe.name, site: p.describe.site, contract: p.describe.contract,
			capabilities: p.describe.capabilities, commands: p.describe.commands.map(c => c.name),
			source: p.source, bin: p.bin.join(" "), account: accounts.has(p.id),
		})),
		broken: bad.map(b => ({ id: b.id, bin: b.bin.join(" "), message: b.message })),
	}
	return { json, render: () => providersTable(ok, bad, accounts) }
}
```

- [ ] **Step 5: `src/commands/accounts.ts`**

```ts
// accounts.ts — менеджер аккаунтов. Обёртка не хранит ни одного секрета:
// login целиком делегируется провайдеру, logout удаляет его файл, whoami
// спрашивает сам провайдер. Тело login содержит токены и наружу не идёт.

import { ProviderError, TOOL } from "../sdk/index.ts"
import { bold, dim, green, renderDisplay } from "../sdk/render.ts"
import type { Display, WhoamiResult } from "../sdk/contract.ts"
import { need, one } from "../core/args.ts"
import { invoke } from "../core/invoke.ts"
import { fanout, passNoise, report } from "../core/partial.ts"
import { accountsTable, type AccountRow } from "../core/render.ts"
import { listAccountIds, removeAccount } from "../core/store.ts"
import { parseDisplay, parseWhoami } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

/** `accounts` и `whoami` — одна и та же таблица; второе имя привычнее. */
export async function cmdAccounts(ctx: Ctx): Promise<Output> {
	const wanted = ctx.args[0]
	const all = await ctx.pick()
	const providers = wanted ? [await one(ctx, wanted)] : all

	const f = await fanout(providers, p => invoke(p.bin, ["whoami"]), parseWhoami, ctx.warn)
	const byId = new Map(f.got.map(g => [g.provider, g.value]))
	const failed = new Map(f.failures.map(x => [x.provider, x.message]))

	const rows: AccountRow[] = providers.map(p => {
		const w: WhoamiResult | undefined = byId.get(p.id)
		const note = failed.get(p.id)
		return { provider: p.id, ok: w?.ok === true, ...(w?.display ? { display: w.display } : {}), ...(note ? { note } : {}) }
	})

	// Файл аккаунта есть, а провайдера нет: чаще всего сайт удалили из PATH.
	// Молчать нельзя — файл с токенами лежит и его надо либо вернуть, либо убрать.
	const known = new Set(all.map(p => p.id))
	const orphans = (await listAccountIds()).filter(id => !known.has(id))

	const json = {
		accounts: rows.map(r => ({ provider: r.provider, ok: r.ok, ...(r.display ? { display: r.display } : {}) })),
		orphans,
		errors: f.failures,
	}
	const code = report(f, [], ctx.warn)
	for (const id of orphans) ctx.warn(dim(`${id}: есть файл аккаунта, а провайдера нет — ${TOOL} logout ${id}`))
	return { json, render: () => accountsTable(rows), code }
}

export async function cmdLogin(ctx: Ctx): Promise<Output> {
	const p = await one(ctx, ctx.args[0])
	// Вход интерактивный: подсказки и ввод идут в терминал напрямую, а таймаут
	// общий (30 с) человеку с паролем короток.
	const r = await invoke(p.bin, ["login"], { interactive: true, timeoutMs: 5 * 60_000 })
	passNoise(p.id, r, ctx.warn)
	if (!r.ok) throw new ProviderError(r.error.code, `${p.id}: ${r.error.message}`)

	// В теле login лежит аккаунт целиком, вместе с токенами. Наружу берём
	// только display: ни в stdout, ни в файл, ни в лог остальное не попадает.
	const display = pickDisplay(r.json, p.id)
	return {
		json: { ok: true, provider: p.id, display },
		render: () => `${green("вошли")} ${bold(p.id)}\n${renderDisplay(display)}`,
	}
}

function pickDisplay(json: unknown, who: string): Display {
	const d = (json as { display?: unknown } | null)?.display
	return parseDisplay(d, who)
}

export async function cmdLogout(ctx: Ctx): Promise<Output> {
	const id = need(ctx.args[0], `имя провайдера — список: ${TOOL} providers`)
	const { ok } = await ctx.load()
	const p = ok.find(x => x.id === id)

	let had = false
	if (p) {
		const r = await invoke(p.bin, ["logout"])
		passNoise(p.id, r, ctx.warn)
		if (r.ok) had = (r.json as { had?: unknown }).had === true
		else ctx.warn(`${id}: ${r.error.message}`)
	}
	// Даже если провайдера уже нет, файл убрать надо: токены не должны
	// переживать logout.
	if (await removeAccount(id)) had = true
	if (!p && !had) throw new ProviderError("bad_args", `нет ни провайдера «${id}», ни его файла аккаунта`)

	return { json: { ok: true, provider: id, had }, render: () => (had ? `аккаунт ${bold(id)} удалён` : dim(`аккаунта ${id} и не было`)) }
}
```

- [ ] **Step 6: Подключить команды и реестр в `src/app.ts`**

Сначала — типы, на которых говорят все команды. `src/core/ctx.ts`:

```ts
// ctx.ts — общий язык команд агрегатора. Команда получает разобранный argv и
// ленивый доступ к провайдерам, а возвращает две формы одного ответа: JSON для
// машины и текст для человека. Печатает их не команда, а app.ts.

import type { Capability } from "../sdk/contract.ts"
import type { Flags } from "../sdk/index.ts"
import type { Loaded, Provider } from "./registry.ts"

export type Ctx = {
	/** Позиционные аргументы после имени команды. */
	args: string[]
	flags: Flags
	json: boolean
	/** Строка в stderr: предупреждения провайдеров и жёлтые строки отказов. */
	warn(line: string): void
	/** Все найденные провайдеры с их describe. Считается один раз на запуск. */
	load(): Promise<Loaded>
	/** Провайдеры после --only/--skip и, если задана, фильтра по capability. */
	pick(cap?: Capability): Promise<Provider[]>
}

export type Output = { json: unknown; render(): string; code?: 0 | 1 | 2 }
```

Дальше `src/app.ts`. Добавить импорты:

```ts
import type { Flags } from "./sdk/index.ts"
import { yellow } from "./sdk/render.ts"
import { cmdAccounts, cmdLogin, cmdLogout } from "./commands/accounts.ts"
import { cmdProviders } from "./commands/providers.ts"
import type { Ctx, Output } from "./core/ctx.ts"
import { load, select, type Loaded } from "./core/registry.ts"
```

Завести таблицу команд рядом с `VALUE_FLAGS`:

```ts
type Handler = (ctx: Ctx) => Promise<Output>

const COMMANDS: Record<string, Handler> = {
	providers: cmdProviders,
	accounts: cmdAccounts,
	whoami: cmdAccounts,
	login: cmdLogin,
	logout: cmdLogout,
}
```

Заменить в `run()` строки от `const name = args[0]` до `throw new ProviderError("bad_args", …)` на разбор через таблицу:

```ts
		const [name, ...rest] = args
		if (!name || flags.help) return { stdout: HELP, stderr, code: 0 }

		const handler = COMMANDS[name]
		if (!handler) throw new ProviderError("bad_args", `неизвестная команда: ${name} — смотри adoc --help`)

		const out = await handler(makeCtx(rest, flags, json, warn))
		return { stdout: `${json ? JSON.stringify(out.json) : out.render()}\n`, stderr, code: out.code ?? 0 }
```

И добавить в конец файла сборку контекста:

```ts
function makeCtx(args: string[], flags: Flags, json: boolean, warn: (line: string) => void): Ctx {
	// describe снимается один раз на запуск: `part` спрашивает провайдеров
	// дважды, а список их команд за время одной команды не меняется.
	let loaded: Promise<Loaded> | null = null
	let toldAboutBad = false
	const ctx: Ctx = {
		args, flags, json, warn,
		load: () => (loaded ??= load()),
		pick: async cap => {
			const l = await ctx.load()
			// Про сломанного провайдера говорим один раз за запуск, а не на
			// каждом вопросе к реестру.
			if (!toldAboutBad) {
				toldAboutBad = true
				for (const b of l.bad) warn(yellow(`${b.id}: провайдер не отвечает по контракту — ${b.message}`))
			}
			return select(l.ok, flags, cap)
		},
	}
	return ctx
}
```

- [ ] **Step 7: Зелёные тесты**

Run: `bun test test/commands && bun run typecheck`
Expected: PASS, 15 тестов.

- [ ] **Step 8: Commit**

```bash
git add src/core/ctx.ts src/core/args.ts src/commands/providers.ts src/commands/accounts.ts src/app.ts test/commands/providers.test.ts test/commands/accounts.test.ts
git commit -m "feat(commands): providers, accounts, whoami, login and logout

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 7: Склейка брендов, предложений и товаров

**Files:**
- Create: `src/core/merge.ts`
- Create: `src/core/errors.ts`
- Create: `src/core/brand.ts`
- Modify: `src/core/render.ts` (таблицы брендов, предложений и товаров)
- Test: `test/core/merge.test.ts`

**Interfaces:**
- Consumes: `articleKey`/`brandKey` из `src/sdk/index.ts`, `fanout`/`failureLine` из `partial.ts`, `parseBrands` из `validate.ts`, `invoke`.
- Produces: типы `Per<T> = {provider: string; items: T[]}`, `OfferRow = Offer & {provider: string}`, `MergedBrand`, `MergedProduct`; `mergeBrands(article, per)`, `splitOffers(article, per)`, `mergeProducts(per)`; класс `Ambiguous extends ProviderError` с полем `brands: MergedBrand[]`; `resolveBrand(providers, article, wanted, warn): Promise<Resolved>` где `Resolved = {brand: MergedBrand | null; all: MergedBrand[]; failures: Failure[]}`; `brandsWhereTable`, `offersTable(rows, from?)`, `productsTable`.

- [ ] **Step 1: Тест склейки**

`test/core/merge.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mergeBrands, mergeProducts, splitOffers } from "../../src/core/merge.ts"
import { resolveBrand } from "../../src/core/brand.ts"
import { Ambiguous } from "../../src/core/errors.ts"
import { load, PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import type { Offer } from "../../src/sdk/contract.ts"

const offer = (o: Partial<Offer> & { price: number }): Offer =>
	({ article: "N90954802", brand: "VAG", currency: "RUB", ...o })

describe("mergeBrands", () => {
	test("одинаковый бренд с разных сайтов — одна строка, написание у каждого своё", () => {
		const m = mergeBrands("n 909 548 02", [
			{ provider: "alpha", items: [{ brand: "VAG", article: "N90954802", name: "Болт", rating: { average: 4.9, count: 56 } }] },
			{ provider: "beta", items: [{ brand: "vag", article: "N 909 548 02" }] },
		])
		expect(m).toHaveLength(1)
		expect(m[0]!.key).toBe("VAG")
		expect(m[0]!.brand).toBe("VAG")
		expect(m[0]!.providers).toEqual(["alpha", "beta"])
		expect(m[0]!.spelling).toEqual({ alpha: "VAG", beta: "vag" })
		expect(m[0]!.rating).toEqual({ average: 4.9, count: 56 })
	})

	test("позиция про чужой артикул отбрасывается", () => {
		const m = mergeBrands("N1", [{ provider: "alpha", items: [{ brand: "VAG", article: "N1" }, { brand: "BOSCH", article: "N2" }] }])
		expect(m.map(b => b.brand)).toEqual(["VAG"])
	})

	test("порядок: сначала бренды, что есть у большего числа сайтов", () => {
		const m = mergeBrands("N1", [
			{ provider: "alpha", items: [{ brand: "ZZZ", article: "N1" }, { brand: "BOSCH", article: "N1" }] },
			{ provider: "beta", items: [{ brand: "BOSCH", article: "N1" }] },
		])
		expect(m.map(b => b.brand)).toEqual(["BOSCH", "ZZZ"])
	})

	test("рейтинг берётся тот, за которым больше оценок", () => {
		const m = mergeBrands("N1", [
			{ provider: "alpha", items: [{ brand: "VAG", article: "N1", rating: { average: 5, count: 2 } }] },
			{ provider: "beta", items: [{ brand: "VAG", article: "N1", rating: { average: 4.2, count: 300 } }] },
		])
		expect(m[0]!.rating).toEqual({ average: 4.2, count: 300 })
	})
})

describe("splitOffers", () => {
	test("точные — по цене, аналоги отдельно", () => {
		const s = splitOffers("N90954802", [
			{ provider: "alpha", items: [offer({ price: 407 }), offer({ price: 900, article: "AN-1", analog: true })] },
			{ provider: "beta", items: [offer({ price: 380 })] },
		])
		expect(s.offers.map(o => [o.provider, o.price])).toEqual([["beta", 380], ["alpha", 407]])
		expect(s.analogs.map(o => o.article)).toEqual(["AN-1"])
	})

	test("чужой артикул без пометки analog — всё равно аналог", () => {
		const s = splitOffers("N90954802", [{ provider: "alpha", items: [offer({ price: 10, article: "ДРУГОЙ" })] }])
		expect(s.offers).toEqual([])
		expect(s.analogs).toHaveLength(1)
	})

	test("одинаковая цена — порядок по имени провайдера, чтобы выдача не прыгала", () => {
		const s = splitOffers("N90954802", [
			{ provider: "beta", items: [offer({ price: 100 })] },
			{ provider: "alpha", items: [offer({ price: 100 })] },
		])
		expect(s.offers.map(o => o.provider)).toEqual(["alpha", "beta"])
	})
})

describe("mergeProducts", () => {
	test("один товар с двух сайтов — одна строка, цена минимальная", () => {
		const m = mergeProducts([
			{ provider: "alpha", items: [{ article: "N90954802", brand: "VAG", name: "Болт", price: 407, quantity: 3 }] },
			{ provider: "beta", items: [{ article: "N 909 548 02", brand: "vag", name: "Болт", price: 380, quantity: 9 }] },
		])
		expect(m).toHaveLength(1)
		expect(m[0]!.price).toBe(380)
		expect(m[0]!.quantity).toBe(9)
		expect(m[0]!.providers).toEqual(["alpha", "beta"])
		expect(m[0]!.prices).toEqual({ alpha: 407, beta: 380 })
	})

	test("порядок: сначала товары с большего числа сайтов, внутри — по цене", () => {
		const m = mergeProducts([
			{ provider: "alpha", items: [{ article: "A", brand: "X", name: "дешёвый", price: 1 }, { article: "B", brand: "X", name: "общий", price: 100 }] },
			{ provider: "beta", items: [{ article: "B", brand: "X", name: "общий", price: 90 }] },
		])
		expect(m.map(p => p.article)).toEqual(["B", "A"])
	})

	test("товар без цены не ломает сортировку", () => {
		const m = mergeProducts([{ provider: "alpha", items: [{ article: "A", brand: "X", name: "без цены" }] }])
		expect(m[0]!.price).toBeUndefined()
	})
})

describe("resolveBrand", () => {
	let dir: string
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "adoc-brand-"))
		process.env[CONFIG_DIR_ENV] = dir
		process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	})
	afterEach(async () => {
		delete process.env[CONFIG_DIR_ENV]
		delete process.env[PROVIDERS_DIR_ENV]
		delete process.env.FAKE_ALPHA_FAIL
		await rm(dir, { recursive: true, force: true })
	})

	test("бренд один — берётся без вопросов", async () => {
		const { ok } = await load()
		const r = await resolveBrand(ok, "n 909 548 02", undefined, () => {})
		expect(r.brand!.key).toBe("VAG")
		expect(r.brand!.providers).toEqual(["alpha", "beta"])
		expect(r.failures).toEqual([])
	})

	test("брендов несколько и бренд не назван — Ambiguous с вариантами", async () => {
		const { ok } = await load()
		const err = await resolveBrand(ok, "multi1", undefined, () => {}).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(Ambiguous)
		expect((err as Ambiguous).brands.map(b => b.key).sort()).toEqual(["OTHER", "VAG"])
		expect((err as Ambiguous).items!.map(i => i.extra)).toEqual([{ providers: ["alpha", "beta"] }, { providers: ["alpha", "beta"] }])
	})

	test("названный бренд выбирается по ключу, регистр не важен", async () => {
		const { ok } = await load()
		const r = await resolveBrand(ok, "multi1", "other", () => {})
		expect(r.brand!.key).toBe("OTHER")
	})

	test("названного бренда нет — Ambiguous с тем же списком", async () => {
		const { ok } = await load()
		const err = await resolveBrand(ok, "multi1", "нетакого", () => {}).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(Ambiguous)
	})

	test("ничего не нашлось — brand null, а не ошибка", async () => {
		const { ok } = await load()
		const r = await resolveBrand(ok, "ЧЕГО-ТАКОГО-НЕТ", undefined, () => {})
		expect(r.brand).toBeNull()
		expect(r.all).toEqual([])
	})

	test("один провайдер упал — второй всё равно даёт бренд", async () => {
		process.env.FAKE_ALPHA_FAIL = "http"
		const { ok } = await load()
		const r = await resolveBrand(ok, "n90954802", undefined, () => {})
		expect(r.brand!.providers).toEqual(["beta"])
		expect(r.failures.map(f => f.provider)).toEqual(["alpha"])
	})
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/core/merge.test.ts`
Expected: FAIL, `Cannot find module '../../src/core/merge.ts'`.

- [ ] **Step 3: `src/core/merge.ts`**

```ts
// merge.ts — склейка выдачи разных сайтов. Что считать «одним и тем же»,
// решают articleKey и brandKey из sdk/keys.ts: второго определения этих
// правил в проекте быть не должно, иначе part и search разъедутся.

import { articleKey, brandKey } from "../sdk/index.ts"
import type { BrandHit, Offer, Product, Rating } from "../sdk/contract.ts"

export type Per<T> = { provider: string; items: T[] }
export type OfferRow = Offer & { provider: string }

export type MergedBrand = {
	/** Ключ склейки: brandKey. */
	key: string
	/** Написание для человека — как показал первый ответивший сайт. */
	brand: string
	article: string
	providers: string[]
	/** Провайдер → его собственное написание бренда; ему же и отправляем. */
	spelling: Record<string, string>
	name?: string
	rating?: Rating
}

export type MergedProduct = Product & { providers: string[]; prices: Record<string, number> }

/** Из двух оценок убедительнее та, за которой больше голосов. */
const better = (a: Rating | undefined, b: Rating | undefined): Rating | undefined =>
	!a ? b : !b ? a : b.count > a.count ? b : a

export function mergeBrands(article: string, per: Per<BrandHit>[]): MergedBrand[] {
	const want = articleKey(article)
	const by = new Map<string, MergedBrand>()
	for (const { provider, items } of per) {
		for (const hit of items) {
			// Сайт вернул позицию про другой артикул — это его подсказка, а не ответ.
			if (articleKey(hit.article) !== want) continue
			const key = brandKey(hit.brand)
			const cur = by.get(key)
			if (!cur) {
				by.set(key, {
					key, brand: hit.brand, article: hit.article, providers: [provider], spelling: { [provider]: hit.brand },
					...(hit.name ? { name: hit.name } : {}), ...(hit.rating ? { rating: hit.rating } : {}),
				})
				continue
			}
			if (!cur.providers.includes(provider)) cur.providers.push(provider)
			cur.spelling[provider] ??= hit.brand
			cur.name ??= hit.name
			cur.rating = better(cur.rating, hit.rating)
		}
	}
	return [...by.values()].sort((a, b) => b.providers.length - a.providers.length || a.key.localeCompare(b.key))
}

export function splitOffers(article: string, per: Per<Offer>[]): { offers: OfferRow[]; analogs: OfferRow[] } {
	const want = articleKey(article)
	const offers: OfferRow[] = []
	const analogs: OfferRow[] = []
	for (const { provider, items } of per) {
		for (const o of items) {
			// Аналог — либо помечен сайтом, либо это просто другой артикул.
			const where = o.analog === true || articleKey(o.article) !== want ? analogs : offers
			where.push({ ...o, provider })
		}
	}
	// Порядок по цене, а при равной — по имени сайта: выдача не должна прыгать
	// между запусками только потому, что кто-то ответил быстрее.
	const byPrice = (a: OfferRow, b: OfferRow): number => a.price - b.price || a.provider.localeCompare(b.provider)
	return { offers: offers.sort(byPrice), analogs: analogs.sort(byPrice) }
}

export function mergeProducts(per: Per<Product>[]): MergedProduct[] {
	const by = new Map<string, MergedProduct>()
	for (const { provider, items } of per) {
		for (const p of items) {
			const key = `${articleKey(p.article)}|${brandKey(p.brand)}`
			const cur = by.get(key)
			if (!cur) {
				by.set(key, { ...p, providers: [provider], prices: p.price === undefined ? {} : { [provider]: p.price } })
				continue
			}
			if (!cur.providers.includes(provider)) cur.providers.push(provider)
			if (p.price !== undefined) {
				cur.prices[provider] = p.price
				// В колонке «ОТ» — минимум по сайтам.
				if (cur.price === undefined || p.price < cur.price) cur.price = p.price
			}
			if (!cur.name && p.name) cur.name = p.name
			if (p.quantity !== undefined) cur.quantity = Math.max(cur.quantity ?? 0, p.quantity)
			cur.rating = better(cur.rating, p.rating)
		}
	}
	return [...by.values()].sort((a, b) =>
		b.providers.length - a.providers.length
		|| (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY)
		|| a.article.localeCompare(b.article))
}
```

- [ ] **Step 4: `src/core/errors.ts`**

```ts
// errors.ts — «уточни бренд». Это не поломка, а вопрос: exit 2, а в теле —
// из чего выбирать. Отдельный класс нужен, чтобы app.ts нарисовал таблицу с
// колонкой «где», которой в контрактном BrandHit нет.

import { ProviderError } from "../sdk/index.ts"
import type { MergedBrand } from "./merge.ts"

export class Ambiguous extends ProviderError {
	constructor(readonly brands: MergedBrand[]) {
		super("ambiguous", "уточни бренд: этот артикул выпускает не один производитель", brands.map(b => ({
			brand: b.brand, article: b.article,
			...(b.name ? { name: b.name } : {}), ...(b.rating ? { rating: b.rating } : {}),
			extra: { providers: b.providers },
		})))
	}
}
```

- [ ] **Step 5: `src/core/brand.ts`**

```ts
// brand.ts — общий для part и reviews шаг «артикул → бренд». Правило жёсткое:
// пока производитель не назван однозначно, дальше идти нельзя — цена, срок и
// отзывы у разных производителей одного артикула разные.

import { brandKey } from "../sdk/index.ts"
import { Ambiguous } from "./errors.ts"
import { invoke } from "./invoke.ts"
import { mergeBrands, type MergedBrand } from "./merge.ts"
import { fanout, type Failure } from "./partial.ts"
import type { Provider } from "./registry.ts"
import { parseBrands } from "./validate.ts"

export type Resolved = {
	/** null — ни у кого ничего не нашлось; это пустой результат, а не ошибка. */
	brand: MergedBrand | null
	all: MergedBrand[]
	failures: Failure[]
}

export async function resolveBrand(
	providers: Provider[], article: string, wanted: string | undefined, warn: (line: string) => void,
): Promise<Resolved> {
	const f = await fanout(providers, p => invoke(p.bin, ["brands", article]), parseBrands, warn)
	const all = mergeBrands(article, f.got.map(g => ({ provider: g.provider, items: g.value })))

	if (!all.length) return { brand: null, all, failures: f.failures }
	if (wanted) {
		const want = brandKey(wanted)
		const hit = all.find(b => b.key === want)
		// Названного бренда нет — показываем те, что есть: человек ошибся в
		// написании чаще, чем сайт потерял производителя.
		if (!hit) throw new Ambiguous(all)
		return { brand: hit, all, failures: f.failures }
	}
	if (all.length > 1) throw new Ambiguous(all)
	return { brand: all[0]!, all, failures: f.failures }
}
```

- [ ] **Step 6: Таблицы в `src/core/render.ts`**

Добавить импорты и три функции:

```ts
import { cyan, days, money } from "../sdk/render.ts"
import type { MergedBrand, MergedProduct, OfferRow } from "./merge.ts"

export function brandsWhereTable(brands: MergedBrand[]): string {
	if (!brands.length) return "не найдено"
	return table(brands.map(b => [
		bold(b.brand), cyan(b.article), (b.name ?? "").slice(0, 40), ratingCell(b.rating), dim(b.providers.join(", ")),
	]), ["БРЕНД", "АРТИКУЛ", "НАЗВАНИЕ", "РЕЙТИНГ", "ГДЕ"])
}

/** `from` — номер первой строки: у аналогов нумерация продолжает основную. */
export function offersTable(rows: OfferRow[], from = 1): string {
	if (!rows.length) return "предложений нет"
	return table(rows.map((o, i) => [
		String(from + i), dim(o.provider), bold(o.brand), (o.name ?? "").slice(0, 36),
		money(o.price), qtyCell(o.quantity),
		o.deliveryDays != null ? days(o.deliveryDays) : o.deliveryDate ?? dim("—"),
		o.seller ?? dim("—"), ratingCell(o.rating),
	]), ["#", "ПРОВАЙДЕР", "БРЕНД", "НАЗВАНИЕ", "ЦЕНА", "НАЛИЧИЕ", "СРОК", "ПРОДАВЕЦ", "РЕЙТИНГ"])
}

export function productsTable(items: MergedProduct[]): string {
	if (!items.length) return "ничего не найдено"
	return table(items.map(p => [
		cyan(p.article), bold(p.brand), p.name.slice(0, 44), money(p.price), qtyCell(p.quantity), ratingCell(p.rating), dim(p.providers.join(", ")),
	]), ["АРТИКУЛ", "БРЕНД", "НАЗВАНИЕ", "ОТ", "НАЛИЧИЕ", "РЕЙТИНГ", "ГДЕ"])
}
```

- [ ] **Step 7: Зелёные тесты**

Run: `bun test test/core/merge.test.ts && bun run typecheck`
Expected: PASS, 16 тестов.

- [ ] **Step 8: Commit**

```bash
git add src/core/merge.ts src/core/errors.ts src/core/brand.ts src/core/render.ts test/core/merge.test.ts
git commit -m "feat(core): merge brands, offers and products across providers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `part` и кэш последней выдачи

**Files:**
- Create: `src/core/lastpart.ts`
- Create: `src/commands/part.ts`
- Modify: `src/app.ts` (команда `part`, отрисовка `Ambiguous`)
- Test: `test/core/lastpart.test.ts`
- Test: `test/commands/part.test.ts`

**Interfaces:**
- Consumes: `resolveBrand`, `splitOffers`, `fanout`/`report`/`failureLine`, `parseOffers`, `offersTable`/`brandsWhereTable`/`hint`, `limitOf`/`need`, `readJson`/`writeJson`.
- Produces: `LAST_PART_FILE = "last-part.json"`, `MAX_AGE_MS`, типы `LastPartLine`, `LastPart`; `saveLastPart(article, brand, rows)`, `lineOf(n, now?)`; `cmdPart(ctx): Promise<Output>`.

- [ ] **Step 1: Тест кэша**

`test/core/lastpart.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { LAST_PART_FILE, lineOf, MAX_AGE_MS, saveLastPart } from "../../src/core/lastpart.ts"
import { readJson } from "../../src/core/store.ts"
import type { OfferRow } from "../../src/core/merge.ts"

const row = (provider: string, price: number, ref?: Record<string, unknown>): OfferRow =>
	({ provider, article: "N90954802", brand: "VAG", name: "Болт", price, currency: "RUB", ...(ref ? { ref } : {}) })

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-last-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

describe("last-part.json", () => {
	test("сохраняются провайдер, цена и ref в порядке строк", async () => {
		await saveLastPart("n90954802", "VAG", [row("beta", 380, { line: "beta-1" }), row("alpha", 407, { line: "alpha-1" })])
		const saved = await readJson<{ article: string; brand: string; lines: { provider: string }[] }>(LAST_PART_FILE)
		expect(saved!.article).toBe("n90954802")
		expect(saved!.brand).toBe("VAG")
		expect(saved!.lines.map(l => l.provider)).toEqual(["beta", "alpha"])
		expect(await lineOf(1)).toMatchObject({ provider: "beta", price: 380, ref: { line: "beta-1" } })
	})

	test("нет файла — понятный отказ, а не пустой ref", async () => {
		expect(lineOf(1)).rejects.toThrow("adoc part")
	})

	test("номер за пределами выдачи", async () => {
		await saveLastPart("N1", "VAG", [row("alpha", 1, { line: "a" })])
		expect(lineOf(2)).rejects.toThrow("1 строк")
	})

	test("выдача старше суток — просим повторить part", async () => {
		await saveLastPart("N1", "VAG", [row("alpha", 1, { line: "a" })])
		expect(lineOf(1, Date.now() + MAX_AGE_MS + 1000)).rejects.toThrow("старше суток")
	})

	test("строка без ref в корзину не кладётся", async () => {
		await saveLastPart("N1", "VAG", [row("alpha", 1)])
		expect(lineOf(1)).rejects.toThrow("ref")
	})
})
```

- [ ] **Step 2: Тест команды**

`test/commands/part.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { LAST_PART_FILE } from "../../src/core/lastpart.ts"
import { readJson } from "../../src/core/store.ts"

type PartJson = {
	article: string
	brand: string | null
	brands: { brand: string; providers: string[] }[]
	offers: { provider: string; price: number; article: string }[]
	analogs: { provider: string; article: string }[]
	errors: { provider: string; code: string }[]
}

let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-part-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_FAIL
	delete process.env.FAKE_BETA_FAIL
	await rm(dir, { recursive: true, force: true })
})

const part = async (args: string[]): Promise<{ code: number; j: PartJson; stderr: string }> => {
	const r = await run(["part", ...args, "--json"])
	return { code: r.code, j: JSON.parse(r.stdout) as PartJson, stderr: r.stderr }
}

describe("adoc part", () => {
	test("предложения обоих сайтов в одной таблице, дешёвое первым", async () => {
		const { code, j } = await part(["n 909 548 02"])
		expect(code).toBe(0)
		expect(j.brand).toBe("VAG")
		expect(j.offers.map(o => [o.provider, o.price])).toEqual([["beta", 380], ["alpha", 407]])
		expect(j.errors).toEqual([])
	})

	test("таблица для человека показывает провайдера и номер строки", async () => {
		const r = await run(["part", "n90954802"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("ПРОВАЙДЕР")
		expect(r.stdout).toContain("beta")
		expect(r.stdout).toContain("basket add")
	})

	test("бренд неоднозначен — exit 2 и таблица вариантов с колонкой «где»", async () => {
		const r = await run(["part", "multi1"])
		expect(r.code).toBe(2)
		expect(r.stderr).toContain("уточни бренд")
		expect(r.stderr).toContain("ГДЕ")
		expect(r.stderr).toContain("OTHER")
	})

	test("тот же случай в --json — тело ambiguous с items", async () => {
		const r = await run(["part", "multi1", "--json"])
		expect(r.code).toBe(2)
		const e = JSON.parse(r.stdout) as { error: { code: string; items: { brand: string; extra: { providers: string[] } }[] } }
		expect(e.error.code).toBe("ambiguous")
		expect(e.error.items.map(i => i.brand).sort()).toEqual(["OTHER", "VAG"])
		expect(e.error.items[0]!.extra.providers).toEqual(["alpha", "beta"])
	})

	test("бренд назван — берётся он, регистр не важен", async () => {
		const { code, j } = await part(["multi1", "other"])
		expect(code).toBe(0)
		expect(j.brand).toBe("OTHER")
		expect(j.offers).toHaveLength(2)
	})

	test("--analogs выносит аналоги отдельным списком", async () => {
		const без = await part(["n90954802"])
		expect(без.j.analogs).toEqual([])
		const с = await part(["n90954802", "--analogs"])
		expect(с.j.analogs.map(o => o.article)).toEqual(["AN-1", "AN-1"])
		expect(с.j.offers).toHaveLength(2)
	})

	test("--only спрашивает только названный сайт", async () => {
		const { j } = await part(["n90954802", "--only", "alpha"])
		expect(j.offers.map(o => o.provider)).toEqual(["alpha"])
		expect(j.brands[0]!.providers).toEqual(["alpha"])
	})

	test("--limit режет таблицу", async () => {
		const { j } = await part(["n90954802", "--limit", "1"])
		expect(j.offers).toHaveLength(1)
		expect(j.offers[0]!.provider).toBe("beta")
	})

	test("один сайт упал — второй печатается, ошибка в errors и жёлтой строкой", async () => {
		process.env.FAKE_ALPHA_FAIL = "auth"
		const { code, j, stderr } = await part(["n90954802"])
		expect(code).toBe(0)
		expect(j.offers.map(o => o.provider)).toEqual(["beta"])
		expect(j.errors).toEqual([{ provider: "alpha", code: "auth", message: expect.any(String) }])
		expect(stderr).toContain("adoc login alpha")
	})

	test("упали все — exit 1", async () => {
		process.env.FAKE_ALPHA_FAIL = "http"
		process.env.FAKE_BETA_FAIL = "http"
		const { code, j } = await part(["n90954802"])
		expect(code).toBe(1)
		expect(j.errors).toHaveLength(2)
	})

	test("ничего не нашлось — это не ошибка", async () => {
		const { code, j } = await part(["НЕТ-ТАКОГО"])
		expect(code).toBe(0)
		expect(j.brand).toBeNull()
		expect(j.offers).toEqual([])
	})

	test("выдача сохраняется в last-part.json в порядке строк таблицы", async () => {
		await run(["part", "n90954802", "--analogs"])
		const saved = await readJson<{ lines: { provider: string; article: string; ref?: unknown }[] }>(LAST_PART_FILE)
		expect(saved!.lines.map(l => [l.provider, l.article])).toEqual([
			["beta", "N 909 548 02"], ["alpha", "N90954802"], ["beta", "AN-1"], ["alpha", "AN-1"],
		])
		expect(saved!.lines[0]!.ref).toEqual({ line: "beta-1" })
	})

	test("без артикула — bad_args", async () => {
		const r = await run(["part", "--json"])
		expect(r.code).toBe(1)
		expect(JSON.parse(r.stdout).error.code).toBe("bad_args")
	})
})
```

- [ ] **Step 3: Запустить, убедиться, что падает**

Run: `bun test test/core/lastpart.test.ts test/commands/part.test.ts`
Expected: FAIL, `Cannot find module '../../src/core/lastpart.ts'`.

- [ ] **Step 4: `src/core/lastpart.ts`**

```ts
// lastpart.ts — последняя выдача `part`. Нужна ровно для одного: чтобы
// `adoc basket add 3` знал, что было третьей строкой и у какого сайта.
// Кэш живёт сутки: цена и срок протухают, а положить в корзину вчерашнюю
// цену — обмануть пользователя молча.

import { ProviderError, TOOL } from "../sdk/index.ts"
import type { OfferRow } from "./merge.ts"
import { readJson, writeJson } from "./store.ts"

export const LAST_PART_FILE = "last-part.json"
export const MAX_AGE_MS = 24 * 60 * 60 * 1000

export type LastPartLine = {
	provider: string
	article: string
	brand: string
	name?: string
	price: number
	/** Непрозрачный объект сайта: уходит обратно в `basket add --ref` как есть. */
	ref?: Record<string, unknown>
}

export type LastPart = { article: string; brand: string; at: string; lines: LastPartLine[] }

export async function saveLastPart(article: string, brand: string, rows: OfferRow[]): Promise<void> {
	const lines: LastPartLine[] = rows.map(o => ({
		provider: o.provider, article: o.article, brand: o.brand, price: o.price,
		...(o.name ? { name: o.name } : {}), ...(o.ref ? { ref: o.ref } : {}),
	}))
	const data: LastPart = { article, brand, at: new Date().toISOString(), lines }
	await writeJson(LAST_PART_FILE, data)
}

/** Строка `n` из последней выдачи. Нумерация — с единицы, как в таблице. */
export async function lineOf(n: number, now: number = Date.now()): Promise<LastPartLine> {
	const lp = await readJson<LastPart>(LAST_PART_FILE)
	if (!lp?.lines?.length) throw new ProviderError("bad_args", `нет сохранённой выдачи — сначала ${TOOL} part <артикул>`)
	const age = now - Date.parse(lp.at)
	if (!Number.isFinite(age) || age > MAX_AGE_MS) throw new ProviderError("bad_args", `выдача старше суток — повтори ${TOOL} part ${lp.article} ${lp.brand}`)
	const line = lp.lines[n - 1]
	if (!line) throw new ProviderError("bad_args", `в последней выдаче ${lp.lines.length} строк(и), а спросили ${n}`)
	if (!line.ref) throw new ProviderError("bad_args", `${line.provider} не дал ref для этой строки — положить в корзину нечем`)
	return line
}
```

- [ ] **Step 5: `src/commands/part.ts`**

```ts
// part.ts — главная команда. Порядок жёсткий и тот же, что у провайдера:
// сначала бренд (шаг brands), потом предложения (шаг offers). Каждому сайту
// уходит его собственное написание бренда — нормализация нужна обёртке для
// склейки, а сайту она чужая.

import { TOOL } from "../sdk/index.ts"
import { bold, cyan, dim, heading } from "../sdk/render.ts"
import { limitOf, need } from "../core/args.ts"
import { resolveBrand } from "../core/brand.ts"
import { invoke } from "../core/invoke.ts"
import { saveLastPart } from "../core/lastpart.ts"
import { splitOffers } from "../core/merge.ts"
import { failureLine, fanout, report } from "../core/partial.ts"
import { hint, offersTable } from "../core/render.ts"
import { parseOffers } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdPart(ctx: Ctx): Promise<Output> {
	const article = need(ctx.args[0], "артикул")
	const providers = await ctx.pick()
	// Бросает Ambiguous — её ловит и рисует app.ts.
	const { brand, all, failures } = await resolveBrand(providers, article, ctx.args[1], ctx.warn)

	const brandsJson = all.map(b => ({ brand: b.brand, article: b.article, ...(b.name ? { name: b.name } : {}), ...(b.rating ? { rating: b.rating } : {}), providers: b.providers }))

	if (!brand) {
		for (const x of failures) ctx.warn(failureLine(x))
		return {
			json: { article, brand: null, brands: [], offers: [], analogs: [], errors: failures },
			render: () => `по ${cyan(article)} ничего не нашлось`,
			code: failures.length === providers.length ? 1 : 0,
		}
	}

	// Спрашиваем только тех, у кого этот бренд есть: остальным вопрос
	// бессмысленен и стоил бы лишних секунд ожидания.
	const holders = providers.filter(p => brand.providers.includes(p.id))
	const analogs = ctx.flags.analogs === true
	const f = await fanout(
		holders,
		p => invoke(p.bin, ["offers", article, "--brand", brand.spelling[p.id]!, ...(analogs ? ["--analogs"] : [])]),
		parseOffers,
		ctx.warn,
	)

	const split = splitOffers(article, f.got.map(g => ({ provider: g.provider, items: g.value })))
	const limit = limitOf(ctx.flags)
	const exact = split.offers.slice(0, limit)
	const extra = analogs ? split.analogs.slice(0, limit) : []

	// Номера строк в таблице и в кэше — одни и те же, иначе `basket add 3`
	// положил бы в корзину не то, что человек прочитал.
	await saveLastPart(article, brand.brand, [...exact, ...extra])
	const code = report(f, failures, ctx.warn)

	return {
		json: {
			article, brand: brand.brand, brands: brandsJson,
			offers: exact, analogs: extra, errors: [...failures, ...f.failures],
		},
		code,
		render: () => {
			const out = [
				`${cyan(article)} · ${bold(brand.brand)} · ${dim(brand.providers.join(", "))}`,
				"",
				offersTable(exact),
			]
			if (split.offers.length > exact.length) out.push(hint(`показано ${exact.length} из ${split.offers.length} — --limit <n>`))
			if (analogs) {
				out.push(heading("Аналоги"), extra.length ? offersTable(extra, exact.length + 1) : dim("аналогов нет"))
			} else if (split.analogs.length) {
				out.push(hint(`есть и аналоги — --analogs`))
			}
			out.push(hint(`${TOOL} basket add <#> [--qty <n>] — положить строку в корзину её сайта`))
			return out.join("\n")
		},
	}
}
```

- [ ] **Step 6: Подключить `part` и отрисовку `Ambiguous` в `src/app.ts`**

Импорты:

```ts
import { cmdPart } from "./commands/part.ts"
import { Ambiguous } from "./core/errors.ts"
import { brandsWhereTable } from "./core/render.ts"
```

В таблицу команд добавить строку `part: cmdPart,`.

В `catch` заменить возврат текстовой ошибки на:

```ts
		const body = errorBody(e)
		const code = exitCode(body.error.code)
		if (json) return { stdout: `${JSON.stringify(body)}\n`, stderr, code }
		// «Уточни бренд» — не ошибка, а список: человеку нужна таблица с
		// колонкой «где», а не одна строка красным.
		const table = e instanceof Ambiguous ? `${brandsWhereTable(e.brands)}\n` : ""
		return { stdout: "", stderr: `${stderr}${red(body.error.message)}\n${table}`, code }
```

- [ ] **Step 7: Зелёные тесты**

Run: `bun test test/core/lastpart.test.ts test/commands/part.test.ts && bun run typecheck`
Expected: PASS, 18 тестов.

- [ ] **Step 8: Commit**

```bash
git add src/core/lastpart.ts src/commands/part.ts src/app.ts test/core/lastpart.test.ts test/commands/part.test.ts
git commit -m "feat(commands): part with brand fan-out, merged offers and last-part cache

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 9: `search`

**Files:**
- Create: `src/commands/search.ts`
- Modify: `src/app.ts` (команда `search`)
- Test: `test/commands/search.test.ts`

**Interfaces:**
- Consumes: `mergeProducts`, `parseProducts`, `productsTable`, `hint`, `limitOf`/`pageOf`/`need`, `fanout`/`report`.
- Produces: `cmdSearch(ctx): Promise<Output>`; форма `--json`: `{query, items: (Product & {providers: string[]; prices: Record<string, number>})[], errors}`.

- [ ] **Step 1: Тест**

`test/commands/search.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"

type SearchJson = {
	query: string
	items: { article: string; price?: number; providers: string[]; prices: Record<string, number> }[]
	errors: { provider: string }[]
}

let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-search-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_FAIL
	delete process.env.FAKE_BETA_FAIL
	await rm(dir, { recursive: true, force: true })
})

const search = async (args: string[]): Promise<SearchJson> =>
	JSON.parse((await run(["search", ...args, "--json"])).stdout) as SearchJson

describe("adoc search", () => {
	test("общий товар — одна строка с двумя сайтами и минимальной ценой", async () => {
		const j = await search(["болт"])
		expect(j.query).toBe("болт")
		expect(j.items[0]!.providers).toEqual(["alpha", "beta"])
		expect(j.items[0]!.price).toBe(380)
		expect(j.items[0]!.prices).toEqual({ alpha: 407, beta: 380 })
	})

	test("свои товары каждого сайта тоже в списке, но ниже общего", async () => {
		const j = await search(["болт"])
		expect(j.items.map(i => i.article)).toEqual(["N90954802", "ALPHA-ONLY", "BETA-ONLY"])
	})

	test("таблица показывает колонку ГДЕ и подсказку про part", async () => {
		const r = await run(["search", "болт"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("ГДЕ")
		expect(r.stdout).toContain("adoc part")
	})

	test("ничего не нашлось — пустой список и код 0", async () => {
		const r = await run(["search", "такого нет", "--json"])
		expect(r.code).toBe(0)
		expect((JSON.parse(r.stdout) as SearchJson).items).toEqual([])
	})

	test("--limit режет итоговый список", async () => {
		const j = await search(["болт", "--limit", "2"])
		expect(j.items).toHaveLength(2)
	})

	test("запрос из нескольких слов не теряется", async () => {
		const j = await search(["такого", "нет"])
		expect(j.query).toBe("такого нет")
	})

	test("один сайт упал — второй показывается", async () => {
		process.env.FAKE_ALPHA_FAIL = "http"
		const j = await search(["болт"])
		expect(j.items.every(i => i.providers.every(p => p === "beta"))).toBe(true)
		expect(j.errors).toHaveLength(1)
	})

	test("упали все — exit 1", async () => {
		process.env.FAKE_ALPHA_FAIL = "http"
		process.env.FAKE_BETA_FAIL = "http"
		expect((await run(["search", "болт", "--json"])).code).toBe(1)
	})
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/commands/search.test.ts`
Expected: FAIL — `неизвестная команда: search`.

- [ ] **Step 3: `src/commands/search.ts`**

```ts
// search.ts — поиск по названию. Сам по себе он не про цену: из его выдачи
// берут артикул с брендом и идут в `part`, где цены и сроки.

import { TOOL } from "../sdk/index.ts"
import { limitOf, need, pageOf } from "../core/args.ts"
import { invoke } from "../core/invoke.ts"
import { mergeProducts } from "../core/merge.ts"
import { fanout, report } from "../core/partial.ts"
import { hint, productsTable } from "../core/render.ts"
import { parseProducts } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdSearch(ctx: Ctx): Promise<Output> {
	// Запрос из нескольких слов приходит несколькими аргументами.
	const query = need(ctx.args.join(" ").trim() || undefined, "текст запроса")
	const providers = await ctx.pick()
	const limit = limitOf(ctx.flags)
	const page = pageOf(ctx.flags)

	const f = await fanout(
		providers,
		p => invoke(p.bin, ["search", query, "--page", String(page), "--limit", String(limit)]),
		parseProducts,
		ctx.warn,
	)
	// Сначала то, что есть у большего числа сайтов: такой товар легче купить.
	const items = mergeProducts(f.got.map(g => ({ provider: g.provider, items: g.value }))).slice(0, limit)
	const code = report(f, [], ctx.warn)

	return {
		json: { query, items, errors: f.failures },
		code,
		render: () => [productsTable(items), hint(`${TOOL} part <артикул> <бренд> — цены, сроки и наличие по строке`)].join("\n"),
	}
}
```

- [ ] **Step 4: Подключить в `src/app.ts`**

Импорт `import { cmdSearch } from "./commands/search.ts"` и строка `search: cmdSearch,` в таблице команд.

- [ ] **Step 5: Зелёные тесты**

Run: `bun test test/commands/search.test.ts && bun run typecheck`
Expected: PASS, 8 тестов.

- [ ] **Step 6: Commit**

```bash
git add src/commands/search.ts src/app.ts test/commands/search.test.ts
git commit -m "feat(commands): search across providers with merged products

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `reviews`

**Files:**
- Create: `src/commands/reviews.ts`
- Modify: `src/app.ts` (команда `reviews`)
- Test: `test/commands/reviews.test.ts`

**Interfaces:**
- Consumes: `resolveBrand`, `parseReviews`, `renderReviews`/`heading` из `src/sdk/render.ts`, `fanout`/`report`.
- Produces: `cmdReviews(ctx): Promise<Output>`; форма `--json`: `{article, brand, providers: {<id>: Reviews}, errors}`.

- [ ] **Step 1: Тест**

`test/commands/reviews.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import type { Reviews } from "../../src/sdk/contract.ts"

type ReviewsJson = { article: string; brand: string | null; providers: Record<string, Reviews>; errors: { provider: string }[] }

let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-rev-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	delete process.env.FAKE_ALPHA_FAIL
	await rm(dir, { recursive: true, force: true })
})

describe("adoc reviews", () => {
	test("отзывы всех сайтов блоками, ключ — id провайдера", async () => {
		const r = await run(["reviews", "n90954802", "--json"])
		expect(r.code).toBe(0)
		const j = JSON.parse(r.stdout) as ReviewsJson
		expect(j.brand).toBe("VAG")
		expect(Object.keys(j.providers)).toEqual(["alpha", "beta"])
		expect(j.providers.alpha!.items[0]!.text).toBe("отзыв у alpha")
	})

	test("для человека — заголовок с именем сайта и гистограмма", async () => {
		const r = await run(["reviews", "n90954802"])
		expect(r.stdout).toContain("alpha")
		expect(r.stdout).toContain("отзывов: 1")
		expect(r.stdout).toContain("5★")
	})

	test("бренд неоднозначен — тот же exit 2, что у part", async () => {
		const r = await run(["reviews", "multi1", "--json"])
		expect(r.code).toBe(2)
		expect(JSON.parse(r.stdout).error.code).toBe("ambiguous")
	})

	test("бренд назван — спрашиваем только про него", async () => {
		const j = JSON.parse((await run(["reviews", "multi1", "OTHER", "--json"])).stdout) as ReviewsJson
		expect(j.brand).toBe("OTHER")
		expect(Object.keys(j.providers)).toEqual(["alpha", "beta"])
	})

	test("артикула нет — пустой ответ, код 0", async () => {
		const r = await run(["reviews", "НЕТ-ТАКОГО", "--json"])
		expect(r.code).toBe(0)
		const j = JSON.parse(r.stdout) as ReviewsJson
		expect(j.brand).toBeNull()
		expect(j.providers).toEqual({})
	})

	test("один сайт упал на шаге брендов — отзывы второго всё равно есть", async () => {
		process.env.FAKE_ALPHA_FAIL = "http"
		const j = JSON.parse((await run(["reviews", "n90954802", "--json"])).stdout) as ReviewsJson
		expect(Object.keys(j.providers)).toEqual(["beta"])
		expect(j.errors.map(e => e.provider)).toEqual(["alpha"])
	})
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/commands/reviews.test.ts`
Expected: FAIL — `неизвестная команда: reviews`.

- [ ] **Step 3: `src/commands/reviews.ts`**

```ts
// reviews.ts — оценки и отзывы. Шаг определения бренда тот же, что у part:
// отзывы привязаны к производителю, а не к номеру детали. Спрашиваются только
// сайты с capability reviews — и только те, у кого этот бренд нашёлся.

import { cyan, heading, renderReviews } from "../sdk/render.ts"
import { limitOf, need } from "../core/args.ts"
import { resolveBrand } from "../core/brand.ts"
import { invoke } from "../core/invoke.ts"
import { failureLine, fanout, report } from "../core/partial.ts"
import { parseReviews } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdReviews(ctx: Ctx): Promise<Output> {
	const article = need(ctx.args[0], "артикул")
	const providers = await ctx.pick()
	const { brand, failures } = await resolveBrand(providers, article, ctx.args[1], ctx.warn)

	if (!brand) {
		for (const x of failures) ctx.warn(failureLine(x))
		return {
			json: { article, brand: null, providers: {}, errors: failures },
			render: () => `по ${cyan(article)} ничего не нашлось`,
			code: failures.length === providers.length ? 1 : 0,
		}
	}

	const holders = (await ctx.pick("reviews")).filter(p => brand.providers.includes(p.id))
	const limit = limitOf(ctx.flags)
	const f = await fanout(
		holders,
		p => invoke(p.bin, ["reviews", article, "--brand", brand.spelling[p.id]!, "--limit", String(limit)]),
		parseReviews,
		ctx.warn,
	)
	const code = report(f, failures, ctx.warn)

	return {
		json: {
			article, brand: brand.brand,
			providers: Object.fromEntries(f.got.map(g => [g.provider, g.value])),
			errors: [...failures, ...f.failures],
		},
		code,
		render: () => f.got.length
			? f.got.map(g => `${heading(`${g.provider} · ${brand.brand} ${article}`)}\n${renderReviews(g.value)}`).join("\n")
			: "отзывов нет",
	}
}
```

- [ ] **Step 4: Подключить в `src/app.ts`**

Импорт `import { cmdReviews } from "./commands/reviews.ts"` и строка `reviews: cmdReviews,` в таблице команд.

- [ ] **Step 5: Зелёные тесты**

Run: `bun test test/commands/reviews.test.ts && bun run typecheck`
Expected: PASS, 6 тестов.

- [ ] **Step 6: Commit**

```bash
git add src/commands/reviews.ts src/app.ts test/commands/reviews.test.ts
git commit -m "feat(commands): reviews from every provider that has them

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: `basket` — мультикорзина

**Files:**
- Create: `src/commands/basket.ts`
- Modify: `src/core/render.ts` (`basketBlock`, `basketTotal`)
- Modify: `src/app.ts` (команда `basket`)
- Test: `test/commands/basket.test.ts`

**Interfaces:**
- Consumes: `lineOf` из `lastpart.ts`, `one`/`need`/`qtyOf`/`refOf` из `args.ts`, `parseBasket`, `invoke`, `fanout`/`report`/`passNoise`.
- Produces: `cmdBasket(ctx): Promise<Output>`; `basketBlock(id, b): string`, `basketTotal(b): number`; форма `--json` списка: `{providers: {<id>: Basket}, total, errors}`, форма изменения: `{provider, basket}`.

- [ ] **Step 1: Тест**

`test/commands/basket.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { accountStore } from "../../src/sdk/account.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { LAST_PART_FILE } from "../../src/core/lastpart.ts"
import { writeJson } from "../../src/core/store.ts"
import type { Basket } from "../../src/sdk/contract.ts"

type ListJson = { providers: Record<string, Basket>; total: number; errors: { provider: string; code: string }[] }
type OneJson = { provider: string; basket: Basket }

let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-basket-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
	await accountStore("alpha").save({ token: "t", user: "pavel" })
	await accountStore("beta").save({ token: "t", user: "pavel" })
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	await rm(dir, { recursive: true, force: true })
})

const list = async (): Promise<ListJson> => JSON.parse((await run(["basket", "--json"])).stdout) as ListJson

describe("adoc basket", () => {
	test("пустые корзины обоих сайтов и общий итог", async () => {
		const j = await list()
		expect(Object.keys(j.providers)).toEqual(["alpha", "beta"])
		expect(j.total).toBe(0)
		expect(j.errors).toEqual([])
	})

	test("basket add <n> берёт строку из последней выдачи part", async () => {
		await run(["part", "n90954802"])
		const r = await run(["basket", "add", "1", "--qty", "2", "--json"])
		expect(r.code).toBe(0)
		const j = JSON.parse(r.stdout) as OneJson
		// Первая строка выдачи — beta, она дешевле.
		expect(j.provider).toBe("beta")
		expect(j.basket.items[0]).toMatchObject({ id: "beta-1", quantity: 2 })
		const all = await list()
		expect(all.total).toBe(760)
		expect(all.providers.alpha!.items).toEqual([])
	})

	test("basket add <provider> --ref кладёт без всякого кэша", async () => {
		const r = await run(["basket", "add", "alpha", "--ref", JSON.stringify({ line: "alpha-1" }), "--json"])
		const j = JSON.parse(r.stdout) as OneJson
		expect(j.provider).toBe("alpha")
		expect(j.basket.items[0]).toMatchObject({ id: "alpha-1", quantity: 1 })
	})

	test("после изменения печатается корзина того сайта, которого тронули", async () => {
		await run(["basket", "add", "alpha", "--ref", JSON.stringify({ line: "alpha-1" })])
		const r = await run(["basket", "set", "alpha", "alpha-1", "--qty", "4"])
		expect(r.stdout).toContain("alpha")
		expect(r.stdout).toContain("итого")
		const j = JSON.parse((await run(["basket", "set", "alpha", "alpha-1", "--qty", "5", "--json"])).stdout) as OneJson
		expect(j.basket.items[0]!.quantity).toBe(5)
	})

	test("basket rm убирает позицию", async () => {
		await run(["basket", "add", "alpha", "--ref", JSON.stringify({ line: "alpha-1" })])
		const j = JSON.parse((await run(["basket", "rm", "alpha", "alpha-1", "--json"])).stdout) as OneJson
		expect(j.basket.items).toEqual([])
	})

	test("итог по всем сайтам складывается", async () => {
		await run(["basket", "add", "alpha", "--ref", JSON.stringify({ line: "alpha-1" })])
		await run(["basket", "add", "beta", "--ref", JSON.stringify({ line: "beta-1" })])
		const j = await list()
		expect(j.total).toBe(787)
	})

	test("сайт без входа — жёлтая строка, остальные печатаются", async () => {
		await accountStore("alpha").clear()
		const r = await run(["basket", "--json"])
		expect(r.code).toBe(0)
		expect(r.stderr).toContain("adoc login alpha")
		const j = JSON.parse(r.stdout) as ListJson
		expect(Object.keys(j.providers)).toEqual(["beta"])
		expect(j.errors[0]).toMatchObject({ provider: "alpha", code: "auth" })
	})

	test("протухший кэш выдачи — просим повторить part", async () => {
		await writeJson(LAST_PART_FILE, {
			article: "N1", brand: "VAG", at: new Date(Date.now() - 48 * 3600_000).toISOString(),
			lines: [{ provider: "alpha", article: "N1", brand: "VAG", price: 1, ref: { line: "alpha-1" } }],
		})
		const r = await run(["basket", "add", "1", "--json"])
		expect(r.code).toBe(1)
		expect(JSON.parse(r.stdout).error.message).toContain("старше суток")
	})

	test("номера строки нет в выдаче", async () => {
		await run(["part", "n90954802"])
		expect(JSON.parse((await run(["basket", "add", "99", "--json"])).stdout).error.code).toBe("bad_args")
	})

	test("set без --qty и rm без itemId — bad_args", async () => {
		expect(JSON.parse((await run(["basket", "set", "alpha", "alpha-1", "--json"])).stdout).error.code).toBe("bad_args")
		expect(JSON.parse((await run(["basket", "rm", "alpha", "--json"])).stdout).error.code).toBe("bad_args")
	})

	test("неизвестная подкоманда", async () => {
		expect(JSON.parse((await run(["basket", "нетакой", "--json"])).stdout).error.message).toContain("нетакой")
	})
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/commands/basket.test.ts`
Expected: FAIL — `неизвестная команда: basket`.

- [ ] **Step 3: Блок корзины в `src/core/render.ts`**

```ts
import type { Basket } from "../sdk/contract.ts"

/** Сумма как её видит сайт; если он её не считает — складываем сами. */
export const basketTotal = (b: Basket): number =>
	b.total ?? b.items.reduce((s, it) => s + (it.sum ?? it.price * it.quantity), 0)

/** Колонка # — номер строки, колонка ID — то, что нужно `basket set` и `basket rm`. */
export function basketBlock(id: string, b: Basket): string {
	const head = bold(id) + (b.url ? dim(`  ${b.url}`) : "")
	if (!b.items.length) return `${head}\n${dim("корзина пуста")}`
	const rows = b.items.map((it, i) => [
		String(i + 1), dim(it.id), cyan(it.article), bold(it.brand), (it.name ?? "").slice(0, 32),
		money(it.price), String(it.quantity), money(it.sum ?? it.price * it.quantity),
		it.deliveryDays != null ? days(it.deliveryDays) : it.deliveryDate ?? dim("—"),
	])
	return [
		head,
		table(rows, ["#", "ID", "АРТИКУЛ", "БРЕНД", "НАЗВАНИЕ", "ЦЕНА", "КОЛ", "СУММА", "СРОК"]),
		`${dim("итого")}  ${bold(money(basketTotal(b)))}`,
	].join("\n")
}
```

- [ ] **Step 4: `src/commands/basket.ts`**

```ts
// basket.ts — мультикорзина. Своей корзины у обёртки нет: каждая позиция
// лежит в корзине своего сайта, обёртка только показывает их вместе и
// пересылает изменения. `ref` для добавления непрозрачен: он пришёл от сайта
// в offers и уходит обратно как есть.

import { ProviderError, TOOL } from "../sdk/index.ts"
import { bold, dim, money } from "../sdk/render.ts"
import type { Basket } from "../sdk/contract.ts"
import { need, one, qtyOf, refOf } from "../core/args.ts"
import { invoke, type InvokeResult } from "../core/invoke.ts"
import { lineOf } from "../core/lastpart.ts"
import { fanout, passNoise, report } from "../core/partial.ts"
import { basketBlock, basketTotal, hint } from "../core/render.ts"
import { parseBasket } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdBasket(ctx: Ctx): Promise<Output> {
	const sub = ctx.args[0]
	if (sub === undefined) return await listBaskets(ctx)
	if (sub === "add") return await addToBasket(ctx)
	if (sub === "set") return await setQuantity(ctx)
	if (sub === "rm") return await removeItem(ctx)
	throw new ProviderError("bad_args", `неизвестная подкоманда корзины: ${sub} — бывают add, set, rm`)
}

async function listBaskets(ctx: Ctx): Promise<Output> {
	const providers = await ctx.pick("basket")
	const f = await fanout(providers, p => invoke(p.bin, ["basket"]), parseBasket, ctx.warn)
	const total = f.got.reduce((s, g) => s + basketTotal(g.value), 0)
	const code = report(f, [], ctx.warn)
	return {
		json: { providers: Object.fromEntries(f.got.map(g => [g.provider, g.value])), total, errors: f.failures },
		code,
		render: () => [
			...f.got.map(g => basketBlock(g.provider, g.value)),
			`${dim("всего по всем сайтам")}  ${bold(money(total))}`,
			hint(`${TOOL} basket set <provider> <ID> --qty <n> · ${TOOL} basket rm <provider> <ID>`),
		].join("\n\n"),
	}
}

async function addToBasket(ctx: Ctx): Promise<Output> {
	const target = ctx.args[1]
	let providerId: string
	let ref: Record<string, unknown>

	if (target !== undefined && /^[0-9]+$/.test(target)) {
		// Короткая форма: номер строки из последней выдачи part.
		const line = await lineOf(Number(target))
		providerId = line.provider
		ref = line.ref! // lineOf не отдаёт строку без ref
	} else {
		providerId = need(target, `номер строки из ${TOOL} part или имя провайдера`)
		ref = refOf(ctx.flags)
	}

	const p = await one(ctx, providerId, "basket")
	const r = await invoke(p.bin, ["basket", "add", "--ref", JSON.stringify(ref), "--qty", String(qtyOf(ctx.flags))])
	return afterChange(ctx, p.id, r)
}

async function setQuantity(ctx: Ctx): Promise<Output> {
	const p = await one(ctx, ctx.args[1], "basket")
	const itemId = need(ctx.args[2], "itemId — колонка ID в выводе корзины")
	if (ctx.flags.qty === undefined) throw new ProviderError("bad_args", "нужен --qty <n>")
	const r = await invoke(p.bin, ["basket", "set", itemId, "--qty", String(qtyOf(ctx.flags))])
	return afterChange(ctx, p.id, r)
}

async function removeItem(ctx: Ctx): Promise<Output> {
	const p = await one(ctx, ctx.args[1], "basket")
	const itemId = need(ctx.args[2], "itemId — колонка ID в выводе корзины")
	const r = await invoke(p.bin, ["basket", "rm", itemId])
	return afterChange(ctx, p.id, r)
}

/**
 * Контракт требует, чтобы add/set/rm возвращали корзину целиком, — поэтому
 * второго вызова после изменения не нужно, печатаем то, что пришло.
 */
function afterChange(ctx: Ctx, id: string, r: InvokeResult): Output {
	passNoise(id, r, ctx.warn)
	if (!r.ok) throw new ProviderError(r.error.code, `${id}: ${r.error.message}`)
	const basket: Basket = parseBasket(r.json, id)
	return { json: { provider: id, basket }, render: () => basketBlock(id, basket) }
}
```

- [ ] **Step 5: Подключить в `src/app.ts`**

Импорт `import { cmdBasket } from "./commands/basket.ts"` и строка `basket: cmdBasket,` в таблице команд.

- [ ] **Step 6: Зелёные тесты**

Run: `bun test test/commands/basket.test.ts && bun run typecheck`
Expected: PASS, 11 тестов.

- [ ] **Step 7: Commit**

```bash
git add src/commands/basket.ts src/core/render.ts src/app.ts test/commands/basket.test.ts
git commit -m "feat(commands): multi-provider basket with add by row number

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 12: `garage` — локальный гараж

**Files:**
- Create: `src/core/garage.ts`
- Create: `src/commands/garage.ts`
- Modify: `src/core/args.ts` (`intFlag`, `strFlag`)
- Modify: `src/core/render.ts` (`garageTable`)
- Modify: `src/app.ts` (команда `garage`)
- Test: `test/core/garage.test.ts`
- Test: `test/commands/garage.test.ts`

**Interfaces:**
- Consumes: `readJson`/`writeJson`, `brandKey`, `positiveInt`.
- Produces: `GARAGE_FILE = "garage.json"`, типы `GarageCar`, `Garage`; `loadGarage()`, `saveGarage(g)`, `addCar(g, car)`, `removeCar(g, id)`, `setMain(g, id)`; `intFlag(flags, name)`, `strFlag(flags, name)`; `garageTable(g)`; `cmdGarage(ctx)`.

- [ ] **Step 1: Тест хранилища гаража**

`test/core/garage.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { addCar, removeCar, setMain, type Garage } from "../../src/core/garage.ts"

const octavia = { brand: "SKODA", model: "OCTAVIA III", year: 2017, vin: "TMBAG7NE0H0000001" }

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

	test("main переставляет звезду", () => {
		let g = addCar({ cars: [] }, octavia).garage
		g = addCar(g, { brand: "VW", model: "GOLF" }).garage
		expect(setMain(g, 2).mainId).toBe(2)
	})
})
```

- [ ] **Step 2: Тест команды**

`test/commands/garage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { GARAGE_FILE, type Garage } from "../../src/core/garage.ts"
import { readJson } from "../../src/core/store.ts"

let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-garage-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
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

	test("add без марки или модели — bad_args", async () => {
		expect(JSON.parse((await run(["garage", "add", "--brand", "SKODA", "--json"])).stdout).error.code).toBe("bad_args")
		expect(JSON.parse((await run(["garage", "add", "--model", "OCTAVIA", "--json"])).stdout).error.code).toBe("bad_args")
	})

	test("--year не число — bad_args", async () => {
		expect(JSON.parse((await add(["--brand", "A", "--model", "B", "--year", "позавчера", "--json"])).stdout).error.code).toBe("bad_args")
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

	test("--json отдаёт весь гараж", async () => {
		await add(["--brand", "SKODA", "--model", "OCTAVIA"])
		const j = JSON.parse((await run(["garage", "--json"])).stdout) as Garage
		expect(j.cars[0]!.brand).toBe("SKODA")
	})

	test("неизвестная подкоманда", async () => {
		expect(JSON.parse((await run(["garage", "нетакой", "--json"])).stdout).error.message).toContain("нетакой")
	})
})
```

- [ ] **Step 3: Запустить, убедиться, что падает**

Run: `bun test test/core/garage.test.ts test/commands/garage.test.ts`
Expected: FAIL, `Cannot find module '../../src/core/garage.ts'`.

- [ ] **Step 4: `src/core/garage.ts`**

```ts
// garage.ts — гараж живёт у пользователя, а не на сайтах. VIN и
// идентификаторы машин — личные данные: они показываются человеку и уходят
// сайту только тогда, когда он сам назвал машину аргументом команды. Сама
// обёртка никому их не рассылает.

import { ProviderError, brandKey } from "../sdk/index.ts"
import type { Car } from "../sdk/contract.ts"
import { readJson, writeJson } from "./store.ts"

export const GARAGE_FILE = "garage.json"

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

export type Garage = { mainId?: number; cars: GarageCar[] }

export const loadGarage = async (): Promise<Garage> => (await readJson<Garage>(GARAGE_FILE)) ?? { cars: [] }
export const saveGarage = (g: Garage): Promise<void> => writeJson(GARAGE_FILE, g)

// Максимум, а не длина списка: после удаления машины длина повторилась бы, и
// два разных автомобиля получили бы один id.
const nextId = (g: Garage): number => g.cars.reduce((m, c) => Math.max(m, c.id), 0) + 1

export function addCar(g: Garage, car: Omit<GarageCar, "id">): { garage: Garage; car: GarageCar } {
	const added: GarageCar = { id: nextId(g), ...car }
	// Первая машина сама становится основной: гараж из одной машины без
	// основной — лишний вопрос к пользователю.
	return { garage: { mainId: g.mainId ?? added.id, cars: [...g.cars, added] }, car: added }
}

export function removeCar(g: Garage, id: number): Garage {
	if (!g.cars.some(c => c.id === id)) throw new ProviderError("bad_args", `нет машины ${id} — смотри adoc garage`)
	const cars = g.cars.filter(c => c.id !== id)
	const mainId = g.mainId === id ? cars[0]?.id : g.mainId
	return { ...(mainId === undefined ? {} : { mainId }), cars }
}

export function setMain(g: Garage, id: number): Garage {
	if (!g.cars.some(c => c.id === id)) throw new ProviderError("bad_args", `нет машины ${id} — смотри adoc garage`)
	return { ...g, mainId: id }
}

const vinKey = (v: string | undefined): string => (v ?? "").trim().toUpperCase()
const roughKey = (c: { brand: string; model: string; year?: number }): string =>
	`${brandKey(c.brand)}|${brandKey(c.model)}|${c.year ?? ""}`

/**
 * Слияние импорта. VIN — единственный настоящий идентификатор автомобиля,
 * поэтому сначала он; марка, модель и год берутся только когда VIN не знает
 * ни та, ни другая сторона. Свои поля не затираются: пользователь мог
 * поправить их руками, а сайт мог их и не знать.
 */
export function mergeImported(g: Garage, provider: string, cars: Car[]): { garage: Garage; added: number; updated: number } {
	let out = g
	let added = 0
	let updated = 0
	for (const car of cars) {
		const vin = vinKey(car.vin)
		const hit = out.cars.find(c => (vin ? vinKey(c.vin) === vin : !vinKey(c.vin) && roughKey(c) === roughKey(car)))
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
```

- [ ] **Step 5: `intFlag` и `strFlag` в `src/core/args.ts`**

```ts
/** Целое ≥ 0: год, пробег. Ноль пробега законен, поэтому не positiveInt. */
export function intFlag(flags: Flags, name: string): number | undefined {
	const v = flags[name]
	if (v === undefined) return undefined
	if (v === true || v === "") throw new ProviderError("bad_args", `--${name}: нужно значение`)
	const n = Number(v)
	if (!Number.isInteger(n) || n < 0) throw new ProviderError("bad_args", `--${name}: нужно целое число не меньше 0, а не «${v}»`)
	return n
}

export function strFlag(flags: Flags, name: string): string | undefined {
	const v = flags[name]
	if (v === true) throw new ProviderError("bad_args", `--${name}: нужно значение`)
	return v === "" ? undefined : v
}
```

- [ ] **Step 6: `garageTable` в `src/core/render.ts`**

```ts
import type { Garage } from "./garage.ts"

/** ★ — основная машина. Колонка «СВЯЗИ» — сайты, откуда машина импортирована. */
export function garageTable(g: Garage): string {
	if (!g.cars.length) return "гараж пуст"
	return table(g.cars.map(c => [
		`${g.mainId === c.id ? yellow("★") : " "}${c.id}`,
		bold([c.brand, c.model].filter(Boolean).join(" ")),
		c.modification ?? c.engine ?? dim("—"),
		c.year ? String(c.year) : dim("—"),
		c.vin ?? dim("—"),
		c.odometer ? `${c.odometer.toLocaleString("ru-RU")} км` : dim("—"),
		dim(Object.keys(c.refs ?? {}).join(", ")),
	]), ["ID", "АВТОМОБИЛЬ", "МОДИФИКАЦИЯ", "ГОД", "VIN", "ПРОБЕГ", "СВЯЗИ"])
}
```

- [ ] **Step 7: `src/commands/garage.ts`**

```ts
// garage.ts — гараж целиком локальный: ни одна из этих подкоманд не ходит в
// сеть. Импорт с сайта — отдельная подкоманда, и её пользователь зовёт сам.

import { ProviderError, TOOL, positiveInt } from "../sdk/index.ts"
import { bold, dim } from "../sdk/render.ts"
import { intFlag, need, strFlag } from "../core/args.ts"
import { addCar, loadGarage, removeCar, saveGarage, setMain } from "../core/garage.ts"
import { garageTable, hint } from "../core/render.ts"
import type { Ctx, Output } from "../core/ctx.ts"

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
		render: () => [garageTable(g), hint(`${TOOL} garage add --brand <марка> --model <модель> · ${TOOL} garage import <provider>`)].join("\n"),
	}
}

async function addToGarage(ctx: Ctx): Promise<Output> {
	const brand = need(strFlag(ctx.flags, "brand"), "--brand <марка>")
	const model = need(strFlag(ctx.flags, "model"), "--model <модель>")
	const { garage, car } = addCar(await loadGarage(), {
		brand, model,
		modification: strFlag(ctx.flags, "modification"),
		year: intFlag(ctx.flags, "year"),
		engine: strFlag(ctx.flags, "engine"),
		vin: strFlag(ctx.flags, "vin"),
		odometer: intFlag(ctx.flags, "odometer"),
	})
	await saveGarage(garage)
	return { json: { ok: true, car }, render: () => `${bold(`${car.brand} ${car.model}`)} добавлена под номером ${car.id}\n${garageTable(garage)}` }
}

async function dropFromGarage(ctx: Ctx): Promise<Output> {
	const id = positiveInt("id машины", need(ctx.args[1], "id машины — колонка ID в adoc garage"))
	const garage = removeCar(await loadGarage(), id)
	await saveGarage(garage)
	return { json: { ok: true, removed: id }, render: () => `${dim(`машина ${id} удалена`)}\n${garageTable(garage)}` }
}

async function chooseMain(ctx: Ctx): Promise<Output> {
	const id = positiveInt("id машины", need(ctx.args[1], "id машины — колонка ID в adoc garage"))
	const garage = setMain(await loadGarage(), id)
	await saveGarage(garage)
	return { json: { ok: true, mainId: id }, render: () => garageTable(garage) }
}
```

- [ ] **Step 8: Подключить в `src/app.ts`**

Импорт `import { cmdGarage } from "./commands/garage.ts"` и строка `garage: cmdGarage,` в таблице команд.

- [ ] **Step 9: Зелёные тесты**

Run: `bun test test/core/garage.test.ts test/commands/garage.test.ts && bun run typecheck`
Expected: PASS, 15 тестов.

- [ ] **Step 10: Commit**

```bash
git add src/core/garage.ts src/commands/garage.ts src/core/args.ts src/core/render.ts src/app.ts test/core/garage.test.ts test/commands/garage.test.ts
git commit -m "feat(commands): local garage with list, add, rm and main

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: `garage import <provider>`

**Files:**
- Modify: `src/commands/garage.ts` (подкоманда `import`)
- Test: `test/core/garage.test.ts` (слияние)
- Test: `test/commands/garage.test.ts` (команда)

**Interfaces:**
- Consumes: `mergeImported(g, provider, cars)`, `parseCars`, `invoke`, `one`, `passNoise`.
- Produces: подкоманда `garage import <provider>`; форма `--json`: `{ok: true, provider, added, updated, garage}`.

- [ ] **Step 1: Тест слияния**

Добавить в `test/core/garage.test.ts`:

```ts
import { mergeImported } from "../../src/core/garage.ts"
import type { Car } from "../../src/sdk/contract.ts"

const fromSite = (over: Partial<Car> = {}): Car =>
	({ brand: "SKODA", model: "OCTAVIA III", year: 2017, vin: "TMBAG7NE0H0000001", ref: { carId: 1 }, ...over })

describe("mergeImported", () => {
	test("в пустой гараж машина просто добавляется вместе с ref", () => {
		const r = mergeImported({ cars: [] }, "alpha", [fromSite()])
		expect(r.added).toBe(1)
		expect(r.updated).toBe(0)
		expect(r.garage.cars[0]!.refs).toEqual({ alpha: { carId: 1 } })
		expect(r.garage.mainId).toBe(1)
	})

	test("та же машина со второго сайта — одна строка и два ref", () => {
		const first = mergeImported({ cars: [] }, "alpha", [fromSite()]).garage
		const r = mergeImported(first, "beta", [fromSite({ ref: { id: "b" } })])
		expect(r.added).toBe(0)
		expect(r.updated).toBe(1)
		expect(r.garage.cars).toHaveLength(1)
		expect(r.garage.cars[0]!.refs).toEqual({ alpha: { carId: 1 }, beta: { id: "b" } })
	})

	test("VIN важнее марки с моделью: другой VIN — другая машина", () => {
		const first = mergeImported({ cars: [] }, "alpha", [fromSite()]).garage
		const r = mergeImported(first, "alpha", [fromSite({ vin: "TMBAG7NE0H0000002" })])
		expect(r.garage.cars).toHaveLength(2)
	})

	test("без VIN с обеих сторон склейка по марке, модели и году", () => {
		const first = mergeImported({ cars: [] }, "alpha", [fromSite({ vin: undefined })]).garage
		const r = mergeImported(first, "beta", [fromSite({ vin: undefined, ref: { id: "b" } })])
		expect(r.garage.cars).toHaveLength(1)
	})

	test("свои поля не затираются, пустые дополняются", () => {
		const mine = { mainId: 1, cars: [{ id: 1, brand: "SKODA", model: "OCTAVIA III", vin: "TMBAG7NE0H0000001", odometer: 120000 }] }
		const r = mergeImported(mine, "alpha", [fromSite({ odometer: 0, modification: "1.8 TSI" })])
		expect(r.garage.cars[0]!.odometer).toBe(120000)
		expect(r.garage.cars[0]!.modification).toBe("1.8 TSI")
	})
})
```

- [ ] **Step 2: Тест команды**

Добавить в `test/commands/garage.test.ts`:

```ts
describe("adoc garage import", () => {
	test("импорт с одного сайта, потом со второго — одна машина и две связи", async () => {
		const first = JSON.parse((await run(["garage", "import", "alpha", "--json"])).stdout) as { added: number; garage: Garage }
		expect(first.added).toBe(1)
		expect(first.garage.cars[0]!.vin).toBe("TMBAG7NE0H0000001")

		const second = JSON.parse((await run(["garage", "import", "beta", "--json"])).stdout) as { added: number; updated: number; garage: Garage }
		expect(second.added).toBe(0)
		expect(second.updated).toBe(1)
		expect(Object.keys(second.garage.cars[0]!.refs ?? {})).toEqual(["alpha", "beta"])
	})

	test("сайт требует входа — ошибка провайдера доносится как есть", async () => {
		await accountStore("alpha").clear()
		const r = await run(["garage", "import", "alpha", "--json"])
		expect(r.code).toBe(1)
		expect(JSON.parse(r.stdout).error.code).toBe("auth")
	})

	test("импорт без имени провайдера — bad_args", async () => {
		expect(JSON.parse((await run(["garage", "import", "--json"])).stdout).error.code).toBe("bad_args")
	})
})
```

Импорт `garage export` у фикстур помечен `auth: true`, поэтому в `beforeEach`
этого файла надо завести аккаунты — добавить туда:

```ts
import { accountStore } from "../../src/sdk/account.ts"
// в beforeEach, после установки ADOC_CONFIG_DIR:
await accountStore("alpha").save({ token: "t", user: "pavel" })
await accountStore("beta").save({ token: "t", user: "pavel" })
```

- [ ] **Step 3: Запустить, убедиться, что падает**

Run: `bun test test/core/garage.test.ts test/commands/garage.test.ts`
Expected: FAIL — `неизвестная подкоманда гаража: import`.

- [ ] **Step 4: Подкоманда в `src/commands/garage.ts`**

Добавить импорты:

```ts
import { one } from "../core/args.ts"
import { invoke } from "../core/invoke.ts"
import { mergeImported } from "../core/garage.ts"
import { passNoise } from "../core/partial.ts"
import { parseCars } from "../core/validate.ts"
```

В `cmdGarage` перед `throw` добавить строку `if (sub === "import") return await importGarage(ctx)`, и функцию:

```ts
/**
 * Забирает машины с сайта в локальный гараж. Обратно ничего не уходит: своя
 * машина может быть заведена и там, где её нет, и это дело пользователя.
 */
async function importGarage(ctx: Ctx): Promise<Output> {
	const p = await one(ctx, ctx.args[1], "garage")
	const r = await invoke(p.bin, ["garage", "export"])
	passNoise(p.id, r, ctx.warn)
	if (!r.ok) throw new ProviderError(r.error.code, `${p.id}: ${r.error.message}`)

	const cars = parseCars(r.json, p.id)
	const { garage, added, updated } = mergeImported(await loadGarage(), p.id, cars)
	await saveGarage(garage)
	return {
		json: { ok: true, provider: p.id, added, updated, garage },
		render: () => `${dim(`с ${p.id}: добавлено ${added}, дополнено ${updated}`)}\n${garageTable(garage)}`,
	}
}
```

- [ ] **Step 5: Зелёные тесты**

Run: `bun test test/core/garage.test.ts test/commands/garage.test.ts && bun run typecheck`
Expected: PASS, 23 теста.

- [ ] **Step 6: Commit**

```bash
git add src/commands/garage.ts test/core/garage.test.ts test/commands/garage.test.ts
git commit -m "feat(commands): garage import with VIN-first merge

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Проброс `adoc <provider> …`

**Files:**
- Create: `src/commands/passthrough.ts`
- Modify: `src/main.ts`
- Test: `test/commands/passthrough.test.ts`

**Interfaces:**
- Consumes: `discover()`, `configDir()`, `CONFIG_DIR_ENV`.
- Produces: `passthrough(argv: string[]): Promise<number | null>` — `null`, если первым словом стоит не провайдер.

- [ ] **Step 1: Тест**

`test/commands/passthrough.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"

const MAIN = join(import.meta.dir, "..", "..", "src", "main.ts")
const FIXTURES = join(import.meta.dir, "..", "fixtures", "providers")

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-pass-")) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function adoc(args: string[]): Promise<{ code: number; out: string; err: string }> {
	const proc = Bun.spawn(["bun", MAIN, ...args], {
		env: { ...process.env, [CONFIG_DIR_ENV]: dir, [PROVIDERS_DIR_ENV]: FIXTURES, NO_COLOR: "1" },
		stdin: "ignore", stdout: "pipe", stderr: "pipe",
	})
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
	return { code: await proc.exited, out, err }
}

describe("adoc <provider> …", () => {
	test("своя команда провайдера идёт как есть", async () => {
		const r = await adoc(["alpha", "hello", "мир"])
		expect(r.code).toBe(0)
		expect(r.out.trim()).toBe("привет, мир")
	})

	test("--json провайдера не переписывается обёрткой", async () => {
		const r = await adoc(["alpha", "hello", "мир", "--json"])
		expect(JSON.parse(r.out)).toEqual({ hello: "мир" })
	})

	test("--help провайдера — его собственная справка", async () => {
		const r = await adoc(["beta", "--help"])
		expect(r.code).toBe(0)
		expect(r.out).toContain("offers <артикул> --brand")
		expect(r.out).toContain("hello")
	})

	test("код возврата провайдера переносится", async () => {
		const r = await adoc(["alpha", "basket"])
		expect(r.code).toBe(1)
		expect(r.err).toContain("нужен вход")
	})

	test("exit 2 провайдера тоже переносится", async () => {
		const proc = Bun.spawn(["bun", MAIN, "alpha", "brands", "N1"], {
			env: { ...process.env, [CONFIG_DIR_ENV]: dir, [PROVIDERS_DIR_ENV]: FIXTURES, NO_COLOR: "1", FAKE_ALPHA_AMBIGUOUS: "1" },
			stdin: "ignore", stdout: "pipe", stderr: "pipe",
		})
		await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(2)
	})

	test("первое слово — не провайдер: разбирает сама обёртка", async () => {
		const r = await adoc(["providers"])
		expect(r.code).toBe(0)
		expect(r.out).toContain("alpha")
	})

	test("флаг первым словом провайдером не считается", async () => {
		const r = await adoc(["--help"])
		expect(r.out).toContain("part")
	})
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/commands/passthrough.test.ts`
Expected: FAIL — `неизвестная команда: alpha`.

- [ ] **Step 3: `src/commands/passthrough.ts`**

```ts
// passthrough.ts — `adoc <provider> <команда> …`. Обёртка не разбирает ни
// команду, ни флаги и не читает вывод: у каждого сайта свой полный CLI, и
// появление у него новой команды не должно требовать правок здесь. stdio
// наследуется целиком — это тот же самый разговор, только имя бинаря короче.

import { CONFIG_DIR_ENV, configDir } from "../sdk/config.ts"
import { discover } from "../core/registry.ts"

/** Код возврата провайдера или null, если первым словом стоит не его id. */
export async function passthrough(argv: string[]): Promise<number | null> {
	const id = argv[0]
	if (!id || id.startsWith("-")) return null
	// Только discover: describe здесь не нужен, а лишний запуск провайдера
	// стоил бы задержки на каждой проброшенной команде.
	const entry = (await discover()).find(p => p.id === id)
	if (!entry) return null

	const proc = Bun.spawn([...entry.bin, ...argv.slice(1)], {
		env: { ...process.env, [CONFIG_DIR_ENV]: configDir() },
		stdin: "inherit", stdout: "inherit", stderr: "inherit",
	})
	return await proc.exited
}
```

- [ ] **Step 4: `src/main.ts`**

```ts
#!/usr/bin/env bun
// adoc — агрегатор магазинов автозапчастей. Справка: adoc --help.

import { run } from "./app.ts"
import { passthrough } from "./commands/passthrough.ts"
import { emit } from "./sdk/out.ts"

const argv = process.argv.slice(2)

// Проброс идёт мимо run(): вывод провайдера — его собственный, обёртка его не
// читает, не переписывает и не буферизует.
const passed = await passthrough(argv)
if (passed !== null) process.exit(passed)

const r = await run(argv)
if (r.stderr) process.stderr.write(r.stderr)
await emit(process.stdout, r.stdout, r.code)
```

- [ ] **Step 5: Зелёные тесты**

Run: `bun test test/commands/passthrough.test.ts && bun run typecheck`
Expected: PASS, 7 тестов.

- [ ] **Step 6: Commit**

```bash
git add src/commands/passthrough.ts src/main.ts test/commands/passthrough.test.ts
git commit -m "feat(commands): passthrough of provider commands with inherited stdio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 15: README и скилл под новую картину мира

**Files:**
- Modify: `README.md`
- Modify: `skills/adoc/SKILL.md`

**Interfaces:** нет.

- [ ] **Step 1: README — переписать сверху вниз**

Порядок разделов: сначала агрегатор, провайдеры вторыми. Убрать раздел «Где это
сейчас» целиком — агрегатор уже есть, «следующего шага» больше нет.

Первый абзац:

````markdown
# adoc

Неофициальный CLI: спрашивает цену, наличие, срок и отзывы по артикулу сразу
у нескольких магазинов автозапчастей и показывает одной таблицей. Сейчас
подключены [autodoc.ru](https://www.autodoc.ru) и [armtek.ru](https://armtek.ru);
добавить свой сайт можно, не трогая код агрегатора — см.
[контракт провайдера](docs/contract.md).

```console
$ adoc part n90954802
N90954802 · VAG · autodoc, armtek

#  ПРОВАЙДЕР  БРЕНД  НАЗВАНИЕ  ЦЕНА   НАЛИЧИЕ  СРОК    ПРОДАВЕЦ  РЕЙТИНГ
1  armtek     VAG    Болт      380 ₽  3 шт     2 дня   armtek    4.5★ (10)
2  autodoc    VAG    Болт      407 ₽  12 шт    1 день  Москва    4.9★ (56)
```
````

Раздел «Команды» — таблица обёртки целиком:

```markdown
| команда | что делает |
|---|---|
| `part <артикул> [бренд]` | предложения всех сайтов одной таблицей, сортировка по цене |
| `search <текст>` | поиск по названию; одинаковый товар с двух сайтов — одна строка |
| `reviews <артикул> [бренд]` | оценки и отзывы всех сайтов, где они есть |
| `basket` | корзины всех сайтов вместе, итог по каждому и общий |
| `basket add <n> [--qty <k>]` | положить строку `n` из последнего `part` в корзину её сайта |
| `basket add <provider> --ref <json> [--qty <k>]` | то же с явным `ref` из `part --json` |
| `basket set <provider> <ID> --qty <k>` | изменить количество |
| `basket rm <provider> <ID>` | убрать позицию |
| `garage` | свой гараж: список, ★ — основная машина |
| `garage add --brand … --model … [--modification --year --vin --engine --odometer]` | завести машину руками |
| `garage import <provider>` | забрать машины с сайта, слияние по VIN |
| `garage main <id>` / `garage rm <id>` | основная / удалить |
| `login <provider>` / `logout <provider>` | вход у сайта / забыть аккаунт |
| `accounts`, `whoami` | кто авторизован, у всех сайтов сразу |
| `providers` | какие сайты подключены, что умеют, чем запускаются |
| `<provider> <команда> …` | команда самого сайта как есть, включая `--help` |

| флаг | что делает |
|---|---|
| `--json` | один JSON-объект в stdout вместо таблиц |
| `--only a,b` (синоним `--providers`) | спрашивать только эти сайты |
| `--skip a,b` | пропустить эти |
| `--limit <n>` | сколько строк показывать, по умолчанию 10 |
| `--page <n>` | страница выдачи у `search` |
| `--analogs` | добавить блок аналогов в `part` |
| `--qty <n>`, `--ref <json>` | количество и предложение для `basket` |
```

Раздел «Как это устроено»:

```markdown
`adoc` — обёртка, каждый сайт — отдельная программа. Обёртка находит их сама:
встроенные лежат в `src/providers/*/main.ts`, чужие — это любые исполняемые
файлы `adoc-<id>` в `PATH`, на любом языке. Разговор всегда один и тот же:
`<провайдер> <команда> … --json`, ровно один JSON-объект в stdout. Таблицы
рисует обёртка.

Упавший сайт не отменяет выдачу: он уезжает жёлтой строкой в stderr и полем
`errors` в `--json`, остальные печатаются. Exit `1` — только когда не ответил
никто; exit `2` — «уточни бренд» со списком вариантов.

Свои файлы обёртки — `~/.config/adoc/garage.json` (гараж живёт локально, а не
на сайтах) и `last-part.json` (последняя выдача `part`, чтобы работало
`basket add <n>`; живёт сутки). Аккаунты пишут сами провайдеры:
`~/.config/adoc/accounts/<id>.json`, права `600`. Каталог переопределяется
`$ADOC_CONFIG_DIR`.
```

Раздел «Свой сайт»: ссылка на `docs/contract.md`, три предложения — исполняемый
`adoc-<id>` в `PATH`, обязателен `describe`, файл аккаунта свой.

Разделы про autodoc и armtek оставить как есть, но переписать вводные фразы:
это теперь «провайдеры, у которых сверх контракта есть свои команды», примеры
команд поменять на `adoc autodoc goods 408` и `adoc armtek vstel`. Раздел
«Протокол `--json`» оставить целиком — он про контракт и не устарел, только
заменить в примерах `adoc-autodoc` на `adoc autodoc`. Раздел «Разработка»
дополнить строкой про `ADOC_PROVIDERS_DIR`:

```markdown
Тесты не ходят в сеть и не трогают настоящий конфиг: `ADOC_CONFIG_DIR` уводит
конфиг во временный каталог, `ADOC_PROVIDERS_DIR` подменяет весь набор
провайдеров фикстурами из `test/fixtures/providers`.
```

- [ ] **Step 2: SKILL — переписать под агрегатор**

`skills/adoc/SKILL.md`, новый `description` во фронтматтере:

```yaml
description: Use when looking up a car part by number or by name across parts shops (autodoc.ru, armtek.ru) — price, availability, delivery time, rating, reviews, analogues — or when working with the user's basket on those sites and their local garage. Also covers why those sites cannot be scraped and how to reach endpoints the CLI has no command for.
```

Содержание, по разделам:

1. **Что это.** `adoc` — обёртка над несколькими магазинами; `adoc providers`
   показывает, какие подключены. Полная справка — `adoc --help`, справка сайта
   — `adoc <сайт> --help`.
2. **Что вызывать** — таблица:

```markdown
| Задача | Команда |
|---|---|
| Есть артикул → цены, сроки, наличие везде | `adoc part <артикул> [бренд]` |
| То же плюс аналоги | `adoc part <артикул> [бренд] --analogs` |
| Только один сайт | `adoc part <артикул> --only autodoc` |
| Название детали → артикулы | `adoc search <текст>` |
| Отзывы и оценки | `adoc reviews <артикул> [бренд]` |
| Корзины всех сайтов | `adoc basket` |
| Положить строку из выдачи `part` | `adoc basket add <#> [--qty <n>]` |
| Машины пользователя | `adoc garage` |
| Кто авторизован | `adoc accounts` |
| Команда конкретного сайта | `adoc <сайт> <команда> …` |
```

3. **Обязательный порядок: артикул → бренд.** Тот же текст, что сейчас, но про
   обёртку: exit `2` и тело `{"error":{"code":"ambiguous","items":[…]}}`, где у
   каждого варианта в `extra.providers` — сайты, у которых он есть.
4. **Частичный отказ.** Жёлтая строка в stderr и `errors` в `--json` — это не
   провал команды: смотри, что пришло от остальных. Exit `1` — только когда не
   ответил никто.
5. **Гараж.** Живёт локально в `~/.config/adoc/garage.json`, а не на сайтах;
   `adoc garage import <сайт>` забирает машины с сайта. VIN и id машин —
   личные данные: показывай пользователю, в сторонние запросы не тащи.
6. **Авторизация — дело пользователя.** Как сейчас, но команды `adoc login
   <сайт>`, `adoc whoami`, `adoc logout <сайт>`. Добавить: **не запускай
   `adoc <сайт> login --json`** — там токены; у обёртки `adoc login` их не
   печатает никогда.
7. **Ловушки** — переписать под обёртку, сохранив по сути нынешние 1, 2, 4, 5:
   - `search` у autodoc отдаёт товары первой подходящей категории; остальные —
	 в `extra.categories`, дальше `adoc autodoc goods <categoryId>`.
   - Оценки ≠ отзывы: `4.91★ (56)` — оценки, «отзывов: 35» — тексты.
   - У armtek цена и срок зависят от точки выдачи: `adoc armtek vstel`.
   - Регистр параметров важен в `adoc autodoc get`.
   - Артикул регистронезависим, пробелы и дефисы не важны — и у обёртки тоже.
8. **Разделы по сайтам** — по абзацу: свои команды autodoc (`goods`, `info`,
   `prices`, `analogs`, `favorites`, `orders`, `profile`, `garage parts`, `get`,
   `post`) и armtek (`info`, `vstel`, `raw`), их карты API.

Убрать из скилла всё, что говорит «бинарь — `adoc-autodoc`, `adoc` пока то же
самое»: теперь `adoc` — обёртка, а `adoc-autodoc` — тот же провайдер, к которому
обёртка ходит сама.

- [ ] **Step 3: Проверить и закоммитить**

Run: `bun test && bun run typecheck`

```bash
git add README.md skills/adoc/SKILL.md
git commit -m "docs: README and skill for the aggregator

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: `--help` из `describe`

**Files:**
- Create: `src/core/help.ts`
- Modify: `src/app.ts` (справка через `helpText`, `--json` без команды)
- Test: `test/commands/help.test.ts`

**Interfaces:**
- Consumes: `Loaded` из `registry.ts`, `TOOL`, `bold`/`dim`.
- Produces: `helpText(loaded: Loaded | null): string`.

- [ ] **Step 1: Тест**

`test/commands/help.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/config.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"

let dir: string
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-help-"))
	process.env[CONFIG_DIR_ENV] = dir
	process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "providers")
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	await rm(dir, { recursive: true, force: true })
})

describe("adoc --help", () => {
	test("свои команды и флаги", async () => {
		const r = await run(["--help"])
		expect(r.code).toBe(0)
		for (const s of ["part <артикул>", "search <текст>", "basket add", "garage import", "providers", "--only", "--analogs"]) {
			expect(r.stdout).toContain(s)
		}
	})

	test("по строке на каждый найденный сайт, из его describe", async () => {
		const r = await run(["--help"])
		expect(r.stdout).toContain("alpha")
		expect(r.stdout).toContain("Fake beta")
		expect(r.stdout).toContain("https://beta.example")
		expect(r.stdout).toContain("basket")
		expect(r.stdout).toContain("adoc <сайт> --help")
	})

	test("сломанный провайдер виден и в справке", async () => {
		process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "odd")
		const r = await run(["--help"])
		expect(r.stdout).toContain("broken")
		expect(r.stdout).toContain("не отвечает по контракту")
	})

	test("провайдеров нет — справка всё равно печатается", async () => {
		process.env[PROVIDERS_DIR_ENV] = join(dir, "пусто")
		const r = await run(["--help"])
		expect(r.code).toBe(0)
		expect(r.stdout).toContain("part <артикул>")
		expect(r.stdout).toContain("ни одного не нашлось")
	})

	test("--json без команды — тело ошибки, а не таблица", async () => {
		for (const args of [["--json"], ["--help", "--json"]]) {
			const r = await run(args)
			expect(r.code).toBe(1)
			expect(r.stdout.trim().split("\n")).toHaveLength(1)
			expect(JSON.parse(r.stdout).error.code).toBe("bad_args")
			expect(JSON.parse(r.stdout).error.message).toContain("providers --json")
		}
	})
})
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/commands/help.test.ts`
Expected: FAIL — справка статична, имени `alpha` в ней нет.

- [ ] **Step 3: `src/core/help.ts`**

```ts
// help.ts — справка обёртки. Свои команды перечислены здесь, а строка про
// каждый сайт собирается из его describe: обёртка не знает заранее, какие
// провайдеры установлены и что они умеют, и врать об этом не должна.

import { TOOL } from "../sdk/config.ts"
import { bold, dim } from "../sdk/render.ts"
import type { Loaded } from "./registry.ts"

type Row = { usage: string; about: string }

const COMMANDS: Row[] = [
	{ usage: "part <артикул> [бренд]", about: "предложения всех сайтов одной таблицей" },
	{ usage: "search <текст>", about: "поиск по названию детали" },
	{ usage: "reviews <артикул> [бренд]", about: "оценки и отзывы" },
	{ usage: "basket", about: "корзины всех сайтов и общий итог" },
	{ usage: "basket add <n|provider>", about: "положить строку из part или предложение по --ref" },
	{ usage: "basket set <provider> <ID>", about: "изменить количество (--qty <n>)" },
	{ usage: "basket rm <provider> <ID>", about: "убрать позицию" },
	{ usage: "garage", about: "свой гараж, ★ — основная машина" },
	{ usage: "garage add --brand … --model …", about: "завести машину руками" },
	{ usage: "garage import <provider>", about: "забрать машины с сайта, слияние по VIN" },
	{ usage: "garage main <id> | rm <id>", about: "основная / удалить" },
	{ usage: "login <provider>", about: "вход у сайта, диалог в терминале" },
	{ usage: "logout <provider>", about: "забыть аккаунт" },
	{ usage: "accounts | whoami", about: "кто авторизован" },
	{ usage: "providers", about: "какие сайты подключены и что умеют" },
	{ usage: "<provider> <команда> …", about: "команда самого сайта как есть" },
]

const FLAGS: Row[] = [
	{ usage: "--json", about: "один JSON-объект в stdout вместо таблиц" },
	{ usage: "--only a,b | --skip a,b", about: "какие сайты спрашивать" },
	{ usage: "--limit <n> | --page <n>", about: "сколько строк и какая страница" },
	{ usage: "--analogs", about: "добавить блок аналогов в part" },
	{ usage: "--qty <n> | --ref <json>", about: "количество и предложение для basket" },
]

export function helpText(loaded: Loaded | null): string {
	const width = Math.max(...[...COMMANDS, ...FLAGS].map(r => r.usage.length))
	const line = (r: Row): string => `  ${r.usage.padEnd(width)}  ${r.about}`
	const out = [
		`${bold(TOOL)} — цены, сроки и отзывы по артикулу сразу в нескольких магазинах`,
		"",
		...COMMANDS.map(line),
		"",
		...FLAGS.map(line),
	]

	// Справка обязана печататься даже когда провайдеров нет или реестр упал:
	// без неё пользователь не узнает, как это чинить.
	if (loaded) {
		out.push("", bold("Сайты"))
		for (const p of loaded.ok) {
			const caps = p.describe.capabilities.length ? dim(`  умеет: ${p.describe.capabilities.join(", ")}`) : ""
			out.push(`  ${p.id.padEnd(12)}${p.describe.name} · ${p.describe.site}${caps}`)
		}
		for (const b of loaded.bad) out.push(`  ${b.id.padEnd(12)}${dim(`не отвечает по контракту: ${b.message}`)}`)
		if (!loaded.ok.length && !loaded.bad.length) out.push(dim(`  ни одного не нашлось — положи исполняемый ${TOOL}-<id> в PATH`))
		out.push("", dim(`  ${TOOL} <сайт> --help — команды самого сайта`))
	}
	return out.join("\n")
}
```

- [ ] **Step 4: `src/app.ts`**

Удалить константу `HELP`, добавить импорт `import { helpText } from "./core/help.ts"` и `import type { Loaded } from "./core/registry.ts"` (если ещё нет).

Внутри `try` перенести создание `ctx` выше ветки справки и заменить саму ветку:

```ts
		const { args, flags } = parseArgv(argv, VALUE_FLAGS)
		const [name, ...rest] = args
		const ctx = makeCtx(rest, flags, json, warn)

		if (!name || flags.help) {
			// Машинному вызову справка бесполезна: он ждёт JSON и получил бы
			// таблицу. Список команд для машины даёт providers --json.
			if (json) {
				const why = flags.help
					? "--help не отдаётся в JSON: список команд и сайтов — adoc providers --json"
					: "нужна команда: смотри adoc --help или adoc providers --json"
				throw new ProviderError("bad_args", why)
			}
			let loaded: Loaded | null = null
			try {
				loaded = await ctx.load()
			} catch {
				// Реестр может упасть на битом PATH — справка важнее.
			}
			return { stdout: `${helpText(loaded)}\n`, stderr, code: 0 }
		}

		const handler = COMMANDS[name]
		if (!handler) throw new ProviderError("bad_args", `неизвестная команда: ${name} — смотри adoc --help`)
		const out = await handler(ctx)
```

- [ ] **Step 5: Зелёные тесты**

Run: `bun test && bun run typecheck`
Expected: PASS — все тесты плана A (213) и плана B.

- [ ] **Step 6: Сверить README с реальной справкой**

Run: `bun src/main.ts --help`
Сверить список команд и флагов с таблицами в README из задачи 15; разошлись —
поправить README, а не справку: справку читают чаще.

- [ ] **Step 7: Commit**

```bash
git add src/core/help.ts src/app.ts test/commands/help.test.ts README.md
git commit -m "feat(core): describe-driven help for the aggregator

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Чек-лист живой проверки после плана B

Сеть и настоящие аккаунты, руками:

1. `adoc providers` — autodoc и armtek с их capabilities и статусом аккаунта.
2. `adoc --help` — свои команды плюс две строки сайтов.
3. `adoc login autodoc`, `adoc login armtek`, потом `adoc accounts` — обе строки «вход есть», токены нигде не напечатаны.
4. `adoc part n90954802` — таблица с колонкой ПРОВАЙДЕР, сортировка по цене; `--analogs` добавляет блок; `--only armtek` спрашивает один сайт.
5. `adoc part 0986452041` — если брендов несколько, exit `2` и таблица с колонкой ГДЕ; повтор с брендом даёт предложения.
6. `adoc search "фильтр масляный"` — общий товар одной строкой с двумя сайтами.
7. `adoc reviews n90954802 VAG` — блоки по сайтам с гистограммой.
8. `adoc basket` → `adoc part …` → `adoc basket add 1 --qty 2` → `adoc basket` — позиция появилась у нужного сайта, итоги сходятся; `basket set` и `basket rm` работают.
9. `adoc garage import autodoc`, потом `adoc garage import armtek` — одна машина с двумя связями; `garage main`, `garage rm`, `garage add` — на месте.
10. `adoc autodoc goods 408` и `adoc armtek vstel` — проброс, вывод сайта как есть, коды возврата переносятся.
11. `adoc logout autodoc` — `accounts` показывает «входа нет», файла `accounts/autodoc.json` нет.
12. Выключить сеть и повторить `adoc part n90954802` — обе жёлтые строки в stderr, exit `1`, паники нет.
13. `ls ~/.config/adoc` — `garage.json`, `last-part.json`, `accounts/`, ничего лишнего; временных `.tmp` не осталось.

## Самопроверка плана

**1. Покрытие спеки.**

| раздел спеки | где закрыт |
|---|---|
| Архитектура: три бинаря, `bin` в package.json | задача 1 |
| Обнаружение провайдеров: встроенные, `adoc-*` в PATH, приоритет встроенного | задача 3 |
| `adoc providers` с версией контракта, capabilities и статусом аккаунта; битый `describe` не в агрегации | задачи 3, 6 |
| Вызов провайдера: spawn, `--json`, мусор в stdout, stderr наружу, stdin только для login, таймаут 30 с и SIGTERM, перенос exit-кода, параллельность | задача 4 |
| Хранилище: `garage.json`, `last-part.json`, перечисление и удаление `accounts/*.json`, атомарная запись | задачи 2, 8, 12 |
| `part`: ключ артикула, склейка брендов, exit 2, свои написания бренда сайтам, точные против аналогов, сортировка, `--limit`, форма `--json` | задачи 7, 8 |
| `search`: склейка по (артикул, бренд), порядок, минимальная цена, подсказка про `part`, форма `--json` | задачи 7, 9 |
| Частичный отказ: жёлтая строка, `errors`, exit 1 только когда упали все, exit 2 только за бренд | задачи 5, 8–11 |
| `basket`: блоки по сайтам, итоги, `add <n>` из `last-part.json`, протухший кэш, `add <provider> --ref`, `set`/`rm`, печать тронутой корзины | задача 11 |
| `reviews`: те же шаги брендов, блоки по сайтам, форма `--json` | задача 10 |
| `garage`: список со звездой, `add`, `main`, `rm`, `import` со слиянием по VIN | задачи 12, 13 |
| `login`/`logout`/`accounts`/`whoami` | задача 6 |
| `<provider> <cmd> …` — проброс, включая `--help` | задача 14 |
| `--help`: справка обёртки плюс строка на провайдера из `describe` | задача 16 |
| Флаги `--json`, `--only`, `--skip`, `--limit`, `--page`, `--analogs` | задачи 1, 3, 8, 9 |
| Тесты: `core/part`, `core/search`, `core/invoke`, `core/garage`, `core/basket`, фикстурный провайдер | задачи 3–13 (`core/part` и `core/search` разложены на `merge.test.ts` плюс `commands/part.test.ts` и `commands/search.test.ts`) |
| Документация: README и SKILL под мультипровайдер | задача 15 |

Не закрыто нарочно и почему:

- **Миграция `token.json` → `accounts/autodoc.json`** — сделана в плане A внутри провайдера autodoc (`migrateLegacyToken`), обёртке добавлять нечего.
- **`docs/contract.md` и `docs/armtek-api.md`** — написаны планами A и C; план B их только читает.
- **Импорт гаража «с сайтов, у которых он есть»** во множественном числе — команда адресная, по одному сайту за раз (`garage import <provider>`), как и в таблице команд спеки.

**2. Поиск заглушек.** Ни одного «TBD», «аналогично задаче N», «добавить обработку ошибок». Все шаги с кодом содержат код целиком; каждый тест выписан. Единственные ссылки на чужой код — на существующие файлы `src/sdk/*`, которые план не переписывает.

**3. Согласованность типов.** Сквозная проверка имён:

- `ProviderEntry`/`Provider`/`BadProvider`/`Loaded` объявлены в задаче 3 и в этих же именах используются задачами 4, 5, 6, 14, 16.
- `invoke(bin, args, opts)` берёт `string[]`, а не `Provider`, — чтобы `registry.ts` мог его звать без цикла импортов; так он и зовётся везде.
- `InvokeResult` — размеченное объединение по `ok`; все потребители (`fanout`, `afterChange`, `cmdLogin`, `cmdLogout`, `importGarage`) проверяют `r.ok` до чтения `r.json`.
- `Fanout<T>` с полями `got`/`failures`/`asked` — одно имя у `partial.ts`, `part`, `search`, `reviews`, `basket`, `accounts`.
- `OfferRow = Offer & {provider}` объявлен в `merge.ts`; `offersTable`, `saveLastPart` и `splitOffers` говорят про него же.
- `MergedBrand.spelling` читается только в `part` и `reviews`, оба через `brand.spelling[p.id]!` после фильтра `brand.providers.includes(p.id)` — ключ гарантированно есть.
- `Ctx.pick(cap?)` и `Ctx.load()` — единственные способы добраться до провайдеров; `one(ctx, id, cap?)` ходит через `ctx.load()`.
- `Output = {json, render, code?}` — форма возврата всех девяти команд; печатает только `app.ts`.
- Имена файлов-констант: `LAST_PART_FILE`, `GARAGE_FILE`, `PROVIDERS_DIR_ENV`, `INVOKE_TIMEOUT_MS`, `MAX_AGE_MS` — объявлены по одному разу и импортируются из своего модуля и в тестах.

## Что дальше

- **План C** — новые провайдеры по тому же контракту; агрегатор для них не меняется. Если меняется — значит, контракт неполон, и правится он, а не `src/core/`.

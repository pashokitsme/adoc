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
- **не** дублирует `articleKey`/`brandKey`, `table`, `money`, `days`, `stars`, `bar`, `fold`, `fields` и **ни один из рендеров** `renderProducts`/`renderBrands`/`renderOffers`/`renderReviews`/`renderBasket`/`renderCars`/`renderDisplay` — свою колонку («ПРОВАЙДЕР», «ГДЕ», «ID») он добавляет параметром `cols`, который эти рендеры получают в задаче 1;
- **не** пишет `accounts/<id>.json` — это делает провайдер (зафиксировано в плане A);
- переиспользует `ProviderError`, `errorBody`, `exitCode` из `src/sdk/errors.ts`: коды и отображение в exit те же самые, второй набор развёлся бы с первым;
- переиспользует `parseArgv`, `need`, `parseRef`, `intFlag`, `positiveInt` из `src/sdk/cli.ts`: соглашения о флагах и тексты ошибок у обёртки и у провайдера обязаны совпадать (`--flag value`, `--flag=value`, значение обязательно, булев флаг берёт только `true`/`false`);
- **берёт всё из одного входа** — `src/sdk/index.ts`. Глубоких импортов вида `../sdk/render.ts` или `../sdk/config.ts` в `src/core/`, `src/commands/`, `src/app.ts` и `src/main.ts` быть не должно: задача 1 доводит `index.ts` до полной поверхности SDK.

## Правки в SDK, которые нужны агрегатору

Все делаются в задаче 1, каждая с причиной:

1. `src/sdk/out.ts`: функция `emit(sink, text, code)` выносится из `src/sdk/run.ts` и экспортируется. Причина: у агрегатора та же беда, что у провайдера, — `process.exit` обрезает stdout за первым буфером пайпа (64 КБ), а `adoc part --json` по нескольким провайдерам этот буфер перерастает. Копировать хитрость в двух местах — заводить два разных бага.
2. `src/sdk/render.ts`: у `renderProducts`, `renderBrands`, `renderOffers`, `renderBasket`, `renderCars` появляется необязательный параметр `cols?: Col<T>[]` — дополнительные колонки вызывающего, встающие **слева**; `renderOffers` получает ещё и `from` (номер первой строки). Плюс `ratingCell`, `qtyCell` и новая `basketTotal` становятся экспортами. Причина: агрегатору нужны те же таблицы плюс колонка источника; писать пять почти дословных копий рендеров — гарантированно получить две разные таблицы для одних и тех же данных.
3. `src/sdk/cli.ts`: `parseRef` и `need` переезжают сюда из `run.ts`, а `num` становится `intFlag(name, v): number | undefined`. Причина: обёртке нужны ровно эти три разбора с ровно теми же текстами ошибок; копия в `core/args.ts` разошлась бы с оригиналом на первой же правке.
4. `src/sdk/index.ts`: доводится до полной поверхности — `parseArgv`, `need`, `parseRef`, `intFlag`, `errorBody`, `exitCode`, `emit`, тип `Flags`, все цвета и рендеры из `render.ts`. Причина: правило «агрегатор берёт SDK только через `index.ts`»; сегодня половина имён доступна лишь глубоким импортом.

Больше в SDK и в провайдерах ничего не меняется.

## Отступления от спеки, зафиксированные здесь

1. **Корзина: две колонки вместо одной.** Спека §`basket` п.4 говорит «колонка `#` показывает и порядковый номер, и `itemId`». `renderBasket` из SDK рисует их раздельно — `#` и `ID`, — и так и остаётся: `itemId` у autodoc это длинный склеенный идентификатор, в одной ячейке с номером строки он нечитаем, а `basket set <provider> <ID>` требует его копировать целиком. Задача 15 правит эту строку спеки.
2. **`--providers` как синоним `--only`.** Спека знает только `--only`/`--skip`; синоним заведён потому, что эту мысль чаще записывают так. Канонический — `--only`.
3. **Владение файлом аккаунта** — уже зафиксировано планом A: файл создаёт и обновляет провайдер, обёртка перечисляет и удаляет.

## Структура файлов

```
src/
  main.ts                 бинарь adoc: проброс или run(), единственный process.exit
  app.ts                  run(argv) → {stdout, stderr, code}; разбор argv, таблица команд
  core/
	ctx.ts                типы Ctx и Output — общий язык команд
	args.ts               limitOf/pageOf/qtyOf/one — разбор аргументов команд поверх sdk/cli.ts
	store.ts              файлы агрегатора: атомарный readJson/writeJson, список и удаление аккаунтов
	registry.ts           обнаружение провайдеров, describe на запуск, выбор по --only/--skip
	validate.ts           проверка форм ответов провайдера по контракту
	invoke.ts             spawn провайдера, таймаут, вырезание JSON, маппинг ошибок, passNoise
	partial.ts            частичный отказ: fanout, Failure, жёлтые строки
	render.ts             только то, чего нет в SDK: колонки агрегатора, таблицы providers и accounts
	merge.ts              склейка брендов, предложений и товаров между провайдерами
	brand.ts              общий шаг «артикул → бренд» и общий пустой результат для part и reviews
	errors.ts             Ambiguous — ошибка «уточни бренд» со списком вариантов
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
  core/{app,store,registry,invoke,partial,merge,lastpart,garage,contract}.test.ts
  commands/{providers,accounts,part,search,reviews,basket,garage,passthrough,help}.test.ts
  fixtures/fake/provider.ts                 makeFake(id, data) — фиктивный провайдер под любой id
  fixtures/providers/{alpha,beta}/main.ts   нормальные фиктивные провайдеры
  fixtures/odd/{noisy,broken}/main.ts       грязный stdout и битый describe
  fixtures/sleepy.ts                        зависший провайдер для теста таймаута
```

Один файл — одна ответственность. `core/` ничего не знает про argv, `commands/` — про spawn, `app.ts` — про формы ответов провайдеров.

---

### Task 1: Бинарь `adoc`, каркас `run()` и правки SDK

**Files:**
- Modify: `package.json`
- Create: `src/sdk/out.ts`
- Modify: `src/sdk/run.ts`
- Modify: `src/sdk/cli.ts`
- Modify: `src/sdk/render.ts`
- Modify: `src/sdk/index.ts`
- Create: `src/app.ts`
- Create: `src/main.ts`
- Test: `test/sdk/render.test.ts`
- Test: `test/core/app.test.ts`

**Interfaces:**
- Consumes: `parseArgv(argv, valueFlags)`, `errorBody(e)`, `exitCode(code)` из `src/sdk/`.
- Produces: `emit(sink, text, code): Promise<never>`; `Col<T> = {head: string; cell: (item: T) => string}`, `CarLike`, `basketTotal(b): number`; `parseRef(v): Record<string, unknown>`, `need(v, what): string`, `intFlag(name, v): number | undefined` из `sdk/cli.ts`; полная поверхность `src/sdk/index.ts`; `run(argv: string[]): Promise<{stdout: string; stderr: string; code: number}>`; бинарь `adoc` → `src/main.ts`.

- [ ] **Step 1: Тест каркаса**

`test/core/app.test.ts`. Каталог конфига и набор провайдеров подменяются с
первого же теста: `run()` в задаче 16 начнёт снимать `describe`, и без этих
двух переменных тест ушёл бы к настоящим `autodoc`/`armtek`, в настоящий
`~/.config/adoc` и в `PATH` разработчика.

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"

const PROVIDERS_DIR_ENV = "ADOC_PROVIDERS_DIR"

let dir: string
let env: Record<string, string>
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "adoc-app-"))
	// Пустой каталог провайдеров: задача 3 заведёт фикстуры, до тех пор набор
	// должен быть пустым, но своим — не настоящим.
	env = { [CONFIG_DIR_ENV]: dir, [PROVIDERS_DIR_ENV]: join(dir, "providers") }
	Object.assign(process.env, env)
})
afterEach(async () => {
	delete process.env[CONFIG_DIR_ENV]
	delete process.env[PROVIDERS_DIR_ENV]
	await rm(dir, { recursive: true, force: true })
})

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
		const proc = Bun.spawn(["bun", bin, "--help"], {
			env: { ...process.env, ...env, NO_COLOR: "1" },
			stdin: "ignore", stdout: "pipe", stderr: "pipe",
		})
		const out = await new Response(proc.stdout).text()
		expect(await proc.exited).toBe(0)
		expect(out).toContain("part")
	})
})
```

- [ ] **Step 2: Тест дополнительных колонок рендера**

Дописать в конец `test/sdk/render.test.ts` (файл уже ставит `NO_COLOR=1` в
первой строке, поэтому строки сравниваются напрямую):

```ts
describe("дополнительные колонки", () => {
	test("встают слева и в шапке, и в строке", () => {
		const out = renderOffers(
			[{ article: "N1", brand: "VAG", price: 407, currency: "RUB" as const, provider: "beta" }],
			[{ head: "ПРОВАЙДЕР", cell: o => o.provider }],
		)
		const lines = out.split("\n")
		expect(lines[0]!.startsWith("ПРОВАЙДЕР")).toBe(true)
		expect(lines[1]!.startsWith("beta")).toBe(true)
		expect(lines[1]).toContain("407 ₽")
	})

	test("from сдвигает нумерацию строк", () => {
		const out = renderOffers([{ article: "N1", brand: "VAG", price: 1, currency: "RUB" as const }], [], 5)
		expect(out.split("\n")[1]!.startsWith("5")).toBe(true)
	})

	test("без колонок вывод прежний", () => {
		const one = { article: "N1", brand: "VAG", price: 1, currency: "RUB" as const }
		expect(renderOffers([one])).toBe(renderOffers([one], []))
	})
})
```

- [ ] **Step 3: Запустить, убедиться, что падает**

Run: `bun test test/core/app.test.ts test/sdk/render.test.ts`
Expected: FAIL — `Cannot find module '../../src/app.ts'` и `renderOffers` не принимает второй аргумент.

- [ ] **Step 4: Вынести `emit` в `src/sdk/out.ts`**

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

В `src/sdk/run.ts` удалить тип `Sink` и функцию `emit` вместе с их комментарием
(строки с `type Sink = …` по конец `async function emit`) и добавить импорт:

```ts
import { emit } from "./out.ts"
```

- [ ] **Step 5: Перенести `parseRef`, `need` и `num` в `src/sdk/cli.ts`**

Дописать в конец `src/sdk/cli.ts`:

```ts
/** Обязательный позиционный аргумент. */
export function need(v: string | undefined, what: string): string {
	if (!v) throw new ProviderError("bad_args", `нужен ${what}`)
	return v
}

/**
 * `--ref <json>` — непрозрачный объект сайта: пришёл в `offers`, уходит обратно
 * в `basket add`. Ни SDK, ни обёртка внутрь не смотрят.
 */
export function parseRef(v: string | true | undefined): Record<string, unknown> {
	if (typeof v !== "string" || !v) throw new ProviderError("bad_args", "нужен --ref <json> из выдачи offers")
	try {
		const o = JSON.parse(v) as unknown
		if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error()
		return o as Record<string, unknown>
	} catch {
		throw new ProviderError("bad_args", "--ref должен быть JSON-объектом")
	}
}

/**
 * Целое ≥ 0: `--qty`, `--year`, `--odometer`. `undefined` — флага нет; ноль
 * законен (пробег), поэтому не `positiveInt`.
 */
export function intFlag(name: string, v: string | true | undefined): number | undefined {
	if (v === undefined) return undefined
	if (v === true || v === "") throw new ProviderError("bad_args", `--${name}: нужно значение`)
	const n = Number(v)
	if (!Number.isInteger(n) || n < 0) throw new ProviderError("bad_args", `--${name}: нужно целое число не меньше нуля, а не «${v}»`)
	return n
}
```

В `src/sdk/run.ts`:

1. удалить функцию `parseRef` и функцию `num` целиком;
2. удалить локальный `const need = (v: string | undefined, what: string): string => {…}` внутри `dispatch`;
3. добавить их в импорт из `./cli.ts`: `import { hasTTY, intFlag, need, parseArgv, parseRef, positiveInt, readLine, readSecret } from "./cli.ts"`;
4. заменить оба вызова `num("qty", ctx.flags.qty, 1)` на `intFlag("qty", ctx.flags.qty) ?? 1`.

- [ ] **Step 6: Дополнительные колонки в `src/sdk/render.ts`**

Заменить блок рендеров (от `renderProducts` до `renderCars`) на этот; `ratingCell`
и `qtyCell` при этом становятся экспортами, а сумма корзины — отдельной функцией:

```ts
/**
 * Дополнительная колонка вызывающего: встаёт слева от таблицы. Так агрегатор
 * добавляет «ПРОВАЙДЕР», «ГДЕ» и «ID» к тем же самым таблицам, вместо того
 * чтобы писать пятую почти дословную копию рендера.
 */
export type Col<T> = { head: string; cell: (item: T) => string }

const heads = <T>(cols: Col<T>[], own: string[]): string[] => [...cols.map(c => c.head), ...own]
const cells = <T>(cols: Col<T>[], item: T, own: string[]): string[] => [...cols.map(c => c.cell(item)), ...own]

export const ratingCell = (r: { average: number; count: number } | undefined) =>
	r && r.count ? `${r.average.toFixed(1)}★ (${r.count})` : dim("—")

export const qtyCell = (q: number | undefined) => (q ? green(`${q} шт`) : dim("нет"))

export function renderProducts<T extends Product>(items: T[], cols: Col<T>[] = []): string {
	if (!items.length) return "ничего не найдено"
	return table(items.map(p => cells(cols, p, [
		cyan(p.article), bold(p.brand), p.name.slice(0, 50),
		money(p.price), qtyCell(p.quantity), ratingCell(p.rating),
	])), heads(cols, ["АРТИКУЛ", "БРЕНД", "НАЗВАНИЕ", "ОТ", "НАЛИЧИЕ", "РЕЙТИНГ"]))
}

export function renderBrands<T extends BrandHit>(items: T[], cols: Col<T>[] = []): string {
	if (!items.length) return "не найдено"
	return table(items.map(b => cells(cols, b, [bold(b.brand), cyan(b.article), b.name ?? "", ratingCell(b.rating)])),
		heads(cols, ["БРЕНД", "АРТИКУЛ", "НАЗВАНИЕ", "РЕЙТИНГ"]))
}

/** `from` — номер первой строки: у блока аналогов нумерация продолжает основную. */
export function renderOffers<T extends Offer>(items: T[], cols: Col<T>[] = [], from = 1): string {
	if (!items.length) return "предложений нет"
	return table(items.map((o, i) => cells(cols, o, [
		String(from + i), bold(o.brand), (o.name ?? "").slice(0, 40), money(o.price), qtyCell(o.quantity),
		o.deliveryDays != null ? days(o.deliveryDays) : (o.deliveryDate ?? dim("—")),
		o.seller ?? dim("—"), ratingCell(o.rating), o.analog ? yellow("аналог") : "",
	])), heads(cols, ["#", "БРЕНД", "НАЗВАНИЕ", "ЦЕНА", "НАЛИЧИЕ", "СРОК", "ПРОДАВЕЦ", "РЕЙТИНГ", ""]))
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

/** Сумма как её считает сайт; если он её не считает — складываем сами. */
export const basketTotal = (b: Basket): number =>
	b.total ?? b.items.reduce((s, it) => s + (it.sum ?? it.price * it.quantity), 0)

export function renderBasket(b: Basket, cols: Col<BasketItem>[] = []): string {
	if (!b.items.length) return "корзина пуста"
	const rows = b.items.map((it, i) => cells(cols, it, [
		`${i + 1}`, dim(it.id), cyan(it.article), bold(it.brand), (it.name ?? "").slice(0, 36),
		money(it.price), `${it.quantity}`, money(it.sum ?? it.price * it.quantity),
		it.deliveryDays != null ? days(it.deliveryDays) : (it.deliveryDate ?? dim("—")),
	]))
	return table(rows, heads(cols, ["#", "ID", "АРТИКУЛ", "БРЕНД", "НАЗВАНИЕ", "ЦЕНА", "КОЛ", "СУММА", "СРОК"])) +
		`\n${dim("итого")}  ${bold(money(basketTotal(b)))}`
}

/**
 * Машина настолько, насколько её рисует таблица: `Car` из контракта и
 * `GarageCar` из локального гаража отличаются идентификаторами, а не тем,
 * что видит человек.
 */
export type CarLike = {
	brand: string
	model: string
	modification?: string
	year?: number
	engine?: string
	vin?: string
	odometer?: number
}

export function renderCars<T extends CarLike>(cars: T[], cols: Col<T>[] = []): string {
	if (!cars.length) return "гараж пуст"
	return table(cars.map(c => cells(cols, c, [
		bold([c.brand, c.model].filter(Boolean).join(" ")), c.modification ?? c.engine ?? dim("—"),
		c.year ? String(c.year) : dim("—"), c.vin ?? dim("—"),
		c.odometer ? `${c.odometer.toLocaleString("ru-RU")} км` : dim("—"),
	])), heads(cols, ["АВТОМОБИЛЬ", "МОДИФИКАЦИЯ", "ГОД", "VIN", "ПРОБЕГ"]))
}
```

Импорт типов в шапке файла дополнить `BasketItem`:

```ts
import type { Basket, BasketItem, BrandHit, Car, Display, Offer, Product, Reviews } from "./contract.ts"
```

`Car` остаётся импортированным: он больше не упоминается в сигнатурах, но
`renderCars(r.cars)` в `run.ts` подставляет именно его — тип `Car` подходит под
`CarLike` структурно, поэтому вызовы в `run.ts` не правятся.

- [ ] **Step 7: Полная поверхность `src/sdk/index.ts`**

Файл целиком:

```ts
// Публичная поверхность SDK. И провайдеры, и агрегатор берут отсюда всё:
// второго входа в SDK нет, глубоких импортов вида ../sdk/render.ts быть не должно.
export { defineProvider } from "./define.ts"
export type { BasketOps, CommandResult, Ctx, ProviderCommand, ProviderSpec } from "./define.ts"
export { runProvider } from "./run.ts"
export { emit } from "./out.ts"
export type { Sink } from "./out.ts"
export { ProviderError, errorBody, exitCode, toProviderError } from "./errors.ts"
export type { ErrorMapper } from "./errors.ts"
export { HttpError, fetchJson } from "./http.ts"
export { articleKey, brandKey } from "./keys.ts"
export { decodeClaims } from "./jwt.ts"
export { hasTTY, intFlag, need, parseArgv, parseRef, positiveInt, readLine, readSecret } from "./cli.ts"
export type { Flags } from "./cli.ts"
export { accountStore } from "./account.ts"
export type { AccountStore } from "./account.ts"
export { CONFIG_DIR_ENV, TOOL, configDir } from "./config.ts"
export * from "./contract.ts"
export {
	bar, basketTotal, bold, cyan, days, dim, fields, fold, green, heading, isoDate, money,
	qtyCell, ratingCell, red, renderBasket, renderBrands, renderCars, renderDisplay,
	renderOffers, renderProducts, renderReviews, stars, table, yellow,
} from "./render.ts"
export type { CarLike, Col } from "./render.ts"
export * as render from "./render.ts"
```

- [ ] **Step 8: `src/app.ts` — каркас**

```ts
// app.ts — argv агрегатора: разбор, выбор команды, сбор вывода. Сам ничего не
// печатает: строки копятся и уходят наружу одним куском, чтобы большой --json
// не обрезался на пайпе (см. sdk/out.ts) и чтобы run() был проверяем тестом.
// Единственное исключение — интерактивный `login`: его диалог идёт прямо в
// терминал, иначе подсказка «Пароль >» появилась бы после ввода пароля.

import { ProviderError, errorBody, exitCode, parseArgv, red } from "./sdk/index.ts"

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

- [ ] **Step 9: `src/main.ts`**

```ts
#!/usr/bin/env bun
// adoc — агрегатор магазинов автозапчастей. Справка: adoc --help.

import { run } from "./app.ts"
import { emit } from "./sdk/index.ts"

const r = await run(process.argv.slice(2))
if (r.stderr) process.stderr.write(r.stderr)
await emit(process.stdout, r.stdout, r.code)
```

- [ ] **Step 10: Бинарь в `package.json`**

Заменить блок `bin` на:

```json
	"bin": {
		"adoc": "./src/main.ts",
		"adoc-autodoc": "./src/providers/autodoc/main.ts",
		"adoc-armtek": "./src/providers/armtek/main.ts"
	},
```

- [ ] **Step 11: Всё зелёное**

Run: `bun test && bun run typecheck`
Expected: PASS. Особое внимание — старым тестам SDK: `sdk/render.test.ts`
(рендеры без колонок печатают ровно то же), `sdk/run.test.ts` (`basket add
--ref "{bad"` по-прежнему `bad_args`, `basket set 7` без `--qty` тоже,
«большой ответ не режется на пайпе» — тоже).

- [ ] **Step 12: Commit**

```bash
git add package.json src/sdk/out.ts src/sdk/run.ts src/sdk/cli.ts src/sdk/index.ts src/sdk/render.ts src/app.ts src/main.ts test/sdk/render.test.ts test/core/app.test.ts
git commit -m "feat(core): adoc binary, aggregator skeleton, SDK columns and shared arg parsers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Хранилище агрегатора

**Files:**
- Create: `src/core/store.ts`
- Test: `test/core/store.test.ts`

**Interfaces:**
- Consumes: `configDir()` из `src/sdk/index.ts`.
- Produces: `filePath(name): string`, `readJson<T>(name): Promise<T | null>`, `writeJson(name, data): Promise<void>`, `listAccountIds(): Promise<string[]>`, `removeAccount(id): Promise<boolean>`.

- [ ] **Step 1: Тест**

`test/core/store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV, accountStore } from "../../src/sdk/index.ts"
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
import { configDir } from "../sdk/index.ts"

/** Нет файла — это состояние, а не сбой. Всё остальное — сбой. */
const missing = (e: unknown): boolean => (e as NodeJS.ErrnoException).code === "ENOENT"

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

const accountsDir = (): string => join(configDir(), "accounts")

/** Кто вошёл хоть раз: имена файлов accounts/<id>.json. Содержимое не читается. */
export async function listAccountIds(): Promise<string[]> {
	try {
		const names = await readdir(accountsDir())
		return names.filter(n => n.endsWith(".json")).map(n => n.slice(0, -".json".length)).sort()
	} catch (e) {
		if (missing(e)) return []
		throw e
	}
}

/**
 * true — файл был и удалён, false — его и не было. Права, занятый файл и
 * каталог вместо файла — это ошибка: `logout`, отрапортовавший успех на
 * неудалённых токенах, хуже, чем `logout`, честно упавший.
 */
export async function removeAccount(id: string): Promise<boolean> {
	try {
		await unlink(join(accountsDir(), `${id}.json`))
		return true
	} catch (e) {
		if (missing(e)) return false
		throw e
	}
}
```

- [ ] **Step 4: Зелёные тесты**

Run: `bun test test/core/store.test.ts && bun run typecheck`
Expected: PASS, 8 тестов.

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
- Consumes: `TOOL`, `ProviderError`, `CONTRACT_VERSION` и типы контракта — всё из `src/sdk/index.ts`.
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

	const auth = (a: FakeAccount | null): void => {
		if (!a) throw new ProviderError("auth", `${id}: нужен вход`)
	}

	// Корзина живёт в файле: каждый вызов — новый процесс, в памяти она
	// забывалась бы между `basket add` и `basket`.
	const basketFile = (): string => join(configDir(), `fake-${id}-basket.json`)
	const load = async (): Promise<Basket> => {
		try {
			return JSON.parse(await readFile(basketFile(), "utf8")) as Basket
		} catch {
			return { items: [], currency: "RUB", total: 0 }
		}
	}
	const store = async (b: Basket): Promise<Basket> => {
		const total = b.items.reduce((s, it) => s + it.price * it.quantity, 0)
		const full: Basket = { ...b, total, currency: "RUB" }
		await mkdir(configDir(), { recursive: true })
		await writeFile(basketFile(), JSON.stringify(full))
		return full
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
// `export {}` — чтобы файл был модулем: иначе tsc падает TS1375 на await
// верхнего уровня.
export {}

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

	test("нет обязательного поля — отказ, и назван именно он", () => {
		expect(() => parseDescribe({ contract: 1, id: "a" }, "a")).toThrow("нет поля name")
		expect(() => parseDescribe({ contract: 1, id: "a", name: "A", site: "s", capabilities: [] }, "a")).toThrow("commands")
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

import { CONTRACT_VERSION, ProviderError } from "../sdk/index.ts"
import type { Basket, BasketItem, BrandHit, Capability, Car, Command, Describe, Display, Offer, Product, Rating, Review, Reviews, WhoamiResult } from "../sdk/index.ts"

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
	// Порядок проверок — от главного к частному: сначала версия и опознание,
	// потом обязательные поля карточки, и только потом список команд. Иначе
	// провайдер без name узнавал бы о себе, что у него «commands — не массив».
	if (o.contract !== CONTRACT_VERSION) fail(who, `контракт версии ${String(o.contract)}, а обёртка знает ${CONTRACT_VERSION}`)
	if (str(o, "id", who) !== id) fail(who, `id в describe — «${String(o.id)}», а бинарь зовётся «${id}»`)
	const name = str(o, "name", who)
	const site = str(o, "site", who)
	// Незнакомая capability — это провайдер новее обёртки, а не поломка:
	// молча отбрасываем, всё известное продолжает работать.
	const capabilities = arr(o.capabilities, who, "capabilities").filter((c): c is Capability => CAPABILITIES.includes(c as Capability))
	const commands: Command[] = arr(o.commands, who, "commands").map(c => {
		const x = obj(c, who, "команда")
		return { name: str(x, "name", who), usage: str(x, "usage", who), about: optStr(x, "about") ?? "", auth: x.auth === true }
	})
	return { contract: CONTRACT_VERSION, id, name, site, capabilities, commands }
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
import { ProviderError, TOOL } from "../sdk/index.ts"
import type { Capability, Describe, Flags } from "../sdk/index.ts"

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
- Produces: `INVOKE_TIMEOUT_MS = 30_000`; типы `InvokeError = {code: ErrorCode; message: string; items?: BrandHit[]}`, `InvokeResult = {ok: true; json: unknown; stderr: string; warnings: string[]} | {ok: false; error: InvokeError; stderr: string; warnings: string[]}`, `InvokeOpts = {timeoutMs?: number; interactive?: boolean; env?: Record<string, string>}`; `invoke(bin: string[], args: string[], opts?: InvokeOpts): Promise<InvokeResult>`; `passNoise(id, r, warn): void`; `load(warn?: (line: string) => void): Promise<Loaded>` в `registry.ts`.

- [ ] **Step 1: Тест**

`test/core/invoke.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
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

	test("предупреждения и stderr describe доходят до warn", async () => {
		process.env[PROVIDERS_DIR_ENV] = join(import.meta.dir, "..", "fixtures", "odd")
		const lines: string[] = []
		await load(l => lines.push(l))
		expect(lines.join(" ")).toContain("сайт просил подождать")
		expect(lines.join(" ")).toContain("не только JSON")
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

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `bun test test/core/invoke.test.ts`
Expected: FAIL, `Cannot find module '../../src/core/invoke.ts'`.

- [ ] **Step 3: `src/core/invoke.ts`**

```ts
// invoke.ts — единственный способ поговорить с провайдером: запустить его
// процессом и прочитать один JSON-объект из stdout. Ни импортов провайдера,
// ни общей памяти: чужая реализация контракта может быть на любом языке.

import { CONFIG_DIR_ENV, TOOL, configDir, yellow } from "../sdk/index.ts"
import type { BrandHit, ErrorCode } from "../sdk/index.ts"

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

/**
 * Разговор провайдера с человеком: его stderr уходит наружу как есть — это
 * его собственные слова, — а наши замечания о его поведении идут подписанными.
 * Зовётся на каждый ответ, включая `describe`: спека требует предупреждать о
 * мусоре в stdout везде, а не только в командах выдачи.
 */
export function passNoise(id: string, r: InvokeResult, warn: (line: string) => void): void {
	if (r.stderr.trim()) warn(r.stderr.replace(/\n+$/, ""))
	for (const w of r.warnings) warn(yellow(`${TOOL}: ${id}: ${w}`))
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
import { invoke, passNoise } from "./invoke.ts"
import { parseDescribe } from "./validate.ts"

/**
 * describe у всех найденных провайдеров параллельно. Ответ кэшируется на
 * запуск (кэшем владеет app.ts), но не на диск: список команд провайдера
 * меняется вместе с его версией, а протухший кэш врал бы в справке.
 * Таймаут короче общего: describe обязан работать без сети.
 * `warn` необязателен только для тестов реестра; команды передают свой.
 */
export async function load(warn: (line: string) => void = () => {}): Promise<Loaded> {
	const entries = await discover()
	const settled = await Promise.all(entries.map(async (e): Promise<Provider | BadProvider> => {
		const r = await invoke(e.bin, ["describe"], { timeoutMs: 10_000 })
		passNoise(e.id, r, warn)
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
Expected: PASS, 12 тестов. Тест про таймаут занимает около 0.3 с — если он тянет секунды, значит `SIGTERM` не доходит.

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
- Consumes: `InvokeResult` и `passNoise(id, r, warn)` из `invoke.ts`, `Provider`/`BadProvider` из `registry.ts`, `table` и цвета из `src/sdk/index.ts`.
- Produces: типы `Failure = {provider: string; code: ErrorCode; message: string}`, `Got<T> = {provider: string; value: T}`, `Fanout<T> = {got: Got<T>[]; failures: Failure[]; asked: number}`; `fanout(providers, call, parse, warn)`, `failureLine(f)`, `allFailed(f)`, `report(f, extra, warn): 0 | 1`; `hint(s)`, `providersTable(ok, bad, accounts)`, `accountsTable(rows)`, тип `AccountRow`.

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

import { TOOL, yellow } from "../sdk/index.ts"
import type { ErrorCode } from "../sdk/index.ts"
import { passNoise, type InvokeResult } from "./invoke.ts"
import type { Provider } from "./registry.ts"

export type Failure = { provider: string; code: ErrorCode; message: string }
export type Got<T> = { provider: string; value: T }
export type Fanout<T> = { got: Got<T>[]; failures: Failure[]; asked: number }

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

import { TOOL, bold, dim, green, red, table, yellow } from "../sdk/index.ts"
import type { Display } from "../sdk/index.ts"
import type { BadProvider, Provider } from "./registry.ts"

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

- [ ] **Step 5: Тест таблиц**

Дописать в `test/core/partial.test.ts` (файл гасит цвет первой строкой
`process.env.NO_COLOR = "1"`, как `test/sdk/render.test.ts`):

```ts
import { accountsTable, providersTable } from "../../src/core/render.ts"

describe("таблицы обёртки", () => {
	test("providers: capabilities, статус аккаунта и чем запускается", () => {
		const out = providersTable(
			[{ ...provider("alpha"), describe: { contract: 1, id: "alpha", name: "Alpha", site: "https://a", capabilities: ["basket"], commands: [] } }],
			[{ id: "broken", bin: ["bun", "/x/broken"], source: "dir", message: "нет поля name" }],
			new Set(["alpha"]),
		)
		const lines = out.split("\n")
		expect(lines[0]).toContain("АККАУНТ")
		expect(lines[1]).toContain("basket")
		expect(lines[1]).toContain("есть")
		expect(lines[2]).toContain("нет поля name")
	})

	test("providers: ни одного — не пустая таблица, а совет", () => {
		expect(providersTable([], [], new Set())).toContain("PATH")
	})

	test("accounts: имя и почта печатаются как есть, отказ — примечанием", () => {
		const out = accountsTable([
			{ provider: "alpha", ok: true, display: { name: "pavel", email: "pavel@alpha.example" } },
			{ provider: "beta", ok: false, note: "HTTP 500" },
		])
		expect(out).toContain("pavel@alpha.example")
		expect(out).toContain("HTTP 500")
		expect(out).toContain("входа нет")
	})

	test("accounts: пустой список", () => {
		expect(accountsTable([])).toBe("аккаунтов нет")
	})
})
```

Первая строка файла — `process.env.NO_COLOR = "1"` до всех импортов.

- [ ] **Step 6: Зелёные тесты**

Run: `bun test test/core/partial.test.ts && bun run typecheck`
Expected: PASS, 12 тестов.

- [ ] **Step 7: Commit**

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
- Consumes: `load(warn)`, `select()`, `invoke()`, `passNoise()`, `fanout()`, `parseWhoami`, `parseDisplay`, `listAccountIds()`, `removeAccount()`, `providersTable`, `accountsTable`; `need`, `positiveInt`, `intFlag` из `sdk/index.ts`.
- Produces: типы `Ctx` и `Output`; `limitOf(flags, def?)`, `pageOf(flags)`, `qtyOf(flags)`, `one(ctx, id, cap?)`; `cmdProviders`, `cmdAccounts`, `cmdLogin`, `cmdLogout` — все типа `(ctx: Ctx) => Promise<Output>`. Разбор `need`, `parseRef` и `intFlag` берётся из `sdk/index.ts` как есть.

- [ ] **Step 1: Тесты**

`test/commands/providers.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV, accountStore } from "../../src/sdk/index.ts"
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
import { CONFIG_DIR_ENV, accountStore } from "../../src/sdk/index.ts"
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

	test("тело login с токенами не уходит ни в stdout, ни в stderr", async () => {
		process.env.FAKE_ALPHA_LOGIN = "pavel"
		process.env.FAKE_ALPHA_PASSWORD = "pw"
		const r = await run(["login", "alpha"])
		expect(r.stdout).not.toContain("t-pavel")
		expect(r.stderr).not.toContain("t-pavel")
		expect(r.stdout).toContain("вошли")
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
// args.ts — аргументы команд обёртки. Числа, JSON и обязательные позиционные
// разбирает sdk/cli.ts: у обёртки и у провайдера должны совпадать не только
// правила, но и тексты ошибок. Здесь остаётся то, чего в SDK нет: значения по
// умолчанию и поиск провайдера по имени.

import { ProviderError, TOOL, intFlag, need, positiveInt } from "../sdk/index.ts"
import type { Capability, Flags } from "../sdk/index.ts"
import type { Ctx } from "./ctx.ts"
import type { Provider } from "./registry.ts"

export const limitOf = (flags: Flags, def = 10): number => (flags.limit === undefined ? def : positiveInt("--limit", flags.limit))
export const pageOf = (flags: Flags): number => (flags.page === undefined ? 1 : positiveInt("--page", flags.page))

/** Количество для корзины: целое ≥ 0, по умолчанию одна штука. */
export const qtyOf = (flags: Flags): number => intFlag("qty", flags.qty) ?? 1

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

import { providersTable } from "../core/render.ts"
import { listAccountIds } from "../core/store.ts"
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

import { ProviderError, TOOL, bold, dim, green, need, renderDisplay } from "../sdk/index.ts"
import type { Display, WhoamiResult } from "../sdk/index.ts"
import { one } from "../core/args.ts"
import { invoke, passNoise } from "../core/invoke.ts"
import { fanout, report } from "../core/partial.ts"
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

	// Единственная команда, чей диалог идёт прямо в терминал: подсказку
	// «Пароль >» нельзя копить до конца, её надо показать до ввода. Поэтому
	// invoke наследует stdin и льёт stderr провайдера сразу — это объявленное
	// исключение из инварианта app.ts «сам ничего не печатает».
	// Таймаут общий (30 с) человеку с паролем короток.
	const r = await invoke(p.bin, ["login"], { interactive: true, timeoutMs: 5 * 60_000 })
	passNoise(p.id, r, ctx.warn)
	// В stdout login лежит аккаунт целиком, вместе с токенами. Отсюда берётся
	// только факт успеха; тело не печатается, не сохраняется и не разбирается.
	if (!r.ok) throw new ProviderError(r.error.code, `${p.id}: ${r.error.message}`)

	// Кто вошёл — спрашиваем отдельным whoami: у него в ответе ровно display и
	// ничего секретного.
	const display = await whoamiOf(ctx, p)
	return {
		json: { ok: true, provider: p.id, ...(display ? { display } : {}) },
		render: () => `${green("вошли")} ${bold(p.id)}\n${renderDisplay(display)}`,
	}
}

async function whoamiOf(ctx: Ctx, p: Provider): Promise<Display | undefined> {
	const r = await invoke(p.bin, ["whoami"])
	passNoise(p.id, r, ctx.warn)
	if (!r.ok) return undefined
	const w = parseWhoami(r.json, p.id)
	return w.ok ? w.display : undefined
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

import type { Capability, Flags } from "../sdk/index.ts"
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
import { yellow, type Flags } from "./sdk/index.ts"
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
		// Предупреждения и stderr от describe тоже принадлежат человеку.
		load: () => (loaded ??= load(warn)),
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
Expected: PASS, 16 тестов.

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
- Modify: `src/core/render.ts` (колонки агрегатора)
- Test: `test/core/merge.test.ts`

**Interfaces:**
- Consumes: `articleKey`/`brandKey`/`Col` из `src/sdk/index.ts`, `fanout`/`failureLine`/`allFailed`/`Fanout` из `partial.ts`, `parseBrands` из `validate.ts`, `invoke`.
- Produces: типы `Per<T> = {provider: string; items: T[]}`, `OfferRow = Offer & {provider: string}`, `MergedBrand`, `MergedProduct`; `mergeBrands(article, per)`, `splitOffers(article, per)`, `mergeProducts(per)`; класс `Ambiguous extends ProviderError` с полем `brands: MergedBrand[]`; `resolveBrand(providers, article, wanted, warn): Promise<Resolved>` где `Resolved = {brand: MergedBrand | null; all: MergedBrand[]; failures: Failure[]; step: Fanout<BrandHit[]>}`; `emptyResult(article, r, rest, warn): Output`; колонки `providerCol: Col<OfferRow>` и `whereCol<T>(): Col<T>`.

- [ ] **Step 1: Тест склейки**

`test/core/merge.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mergeBrands, mergeProducts, splitOffers } from "../../src/core/merge.ts"
import { emptyResult, resolveBrand } from "../../src/core/brand.ts"
import { Ambiguous } from "../../src/core/errors.ts"
import { load, PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import type { Offer } from "../../src/sdk/index.ts"

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
		delete process.env.FAKE_BETA_FAIL
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

	test("пустая выдача: код 0, когда кто-то ответил, и 1, когда не ответил никто", async () => {
		const { ok } = await load()
		const quiet = await resolveBrand(ok, "ЧЕГО-ТАКОГО-НЕТ", undefined, () => {})
		expect(emptyResult("ЧЕГО-ТАКОГО-НЕТ", quiet, { offers: [] }, () => {}).code).toBe(0)

		process.env.FAKE_ALPHA_FAIL = "http"
		process.env.FAKE_BETA_FAIL = "http"
		const dead = await resolveBrand((await load()).ok, "n90954802", undefined, () => {})
		expect(emptyResult("n90954802", dead, { offers: [] }, () => {}).code).toBe(1)
		delete process.env.FAKE_BETA_FAIL
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
import type { BrandHit, Offer, Product, Rating } from "../sdk/index.ts"

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
// отзывы у разных производителей одного артикула разные. Здесь же общий ответ
// «ничего не нашлось»: обе команды должны считать код возврата одинаково.

import { brandKey, cyan } from "../sdk/index.ts"
import type { BrandHit } from "../sdk/index.ts"
import type { Output } from "./ctx.ts"
import { Ambiguous } from "./errors.ts"
import { invoke } from "./invoke.ts"
import { mergeBrands, type MergedBrand } from "./merge.ts"
import { allFailed, failureLine, fanout, type Failure, type Fanout } from "./partial.ts"
import type { Provider } from "./registry.ts"
import { parseBrands } from "./validate.ts"

export type Resolved = {
	/** null — ни у кого ничего не нашлось; это пустой результат, а не ошибка. */
	brand: MergedBrand | null
	all: MergedBrand[]
	failures: Failure[]
	/** Шаг брендов целиком: из него берётся код возврата пустой выдачи. */
	step: Fanout<BrandHit[]>
}

export async function resolveBrand(
	providers: Provider[], article: string, wanted: string | undefined, warn: (line: string) => void,
): Promise<Resolved> {
	const step = await fanout(providers, p => invoke(p.bin, ["brands", article]), parseBrands, warn)
	const all = mergeBrands(article, step.got.map(g => ({ provider: g.provider, items: g.value })))
	const base = { all, failures: step.failures, step }

	if (!all.length) return { brand: null, ...base }
	if (wanted) {
		const want = brandKey(wanted)
		const hit = all.find(b => b.key === want)
		// Названного бренда нет — показываем те, что есть: человек ошибается в
		// написании чаще, чем сайт теряет производителя.
		if (!hit) throw new Ambiguous(all)
		return { brand: hit, ...base }
	}
	if (all.length > 1) throw new Ambiguous(all)
	return { brand: all[0]!, ...base }
}

/**
 * Ни у кого ничего не нашлось. Пустой результат — не ошибка; ошибка — только
 * когда не ответил никто, и решает это `allFailed`, а не пересчёт в команде.
 * `rest` — остаток формы `--json`, у part и reviews он разный.
 */
export function emptyResult(article: string, r: Resolved, rest: Record<string, unknown>, warn: (line: string) => void): Output {
	for (const f of r.failures) warn(failureLine(f))
	return {
		json: { article, brand: null, ...rest, errors: r.failures },
		render: () => `по ${cyan(article)} ничего не нашлось`,
		code: allFailed(r.step) ? 1 : 0,
	}
}
```

- [ ] **Step 6: Колонки в `src/core/render.ts`**

Своих таблиц у обёртки нет: она берёт рендеры SDK и добавляет к ним колонку
источника. Дописать в `src/core/render.ts` (импорт `Col` — к уже имеющемуся
импорту из `../sdk/index.ts`):

```ts
import type { Col } from "../sdk/index.ts"
import type { OfferRow } from "./merge.ts"

/** Колонка «ПРОВАЙДЕР»: в таблице обёртки строки приходят из разных мест. */
export const providerCol: Col<OfferRow> = { head: "ПРОВАЙДЕР", cell: o => dim(o.provider) }

/** Колонка «ГДЕ»: у каких сайтов есть эта строка. */
export const whereCol = <T extends { providers: string[] }>(): Col<T> =>
	({ head: "ГДЕ", cell: x => dim(x.providers.join(", ")) })
```

Таблицы рисуются вызовами SDK: `renderOffers(rows, [providerCol])`,
`renderOffers(analogs, [providerCol], exact.length + 1)`,
`renderProducts(items, [whereCol<MergedProduct>()])`,
`renderBrands(brands, [whereCol<MergedBrand>()])`. Отдельных `offersTable`,
`productsTable` и `brandsWhereTable` не заводится.

- [ ] **Step 7: Зелёные тесты**

Run: `bun test test/core/merge.test.ts && bun run typecheck`
Expected: PASS, 17 тестов.

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
- Consumes: `resolveBrand`/`emptyResult` из `brand.ts`, `splitOffers`, `fanout`/`report`, `parseOffers`, `renderOffers`/`renderBrands`/`need` из `sdk/index.ts`, `providerCol`/`whereCol`/`hint`, `limitOf`, `readJson`/`writeJson`.
- Produces: `LAST_PART_FILE = "last-part.json"`, `MAX_AGE_MS`, типы `LastPartLine`, `LastPart`; `saveLastPart(article, brand, rows)`, `lineOf(n, now?)`; `cmdPart(ctx): Promise<Output>`.

- [ ] **Step 1: Тест кэша**

`test/core/lastpart.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
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
		await expect(lineOf(1)).rejects.toThrow("adoc part")
	})

	test("номер за пределами выдачи", async () => {
		await saveLastPart("N1", "VAG", [row("alpha", 1, { line: "a" })])
		await expect(lineOf(2)).rejects.toThrow("1 строк")
	})

	test("выдача старше суток — просим повторить part", async () => {
		await saveLastPart("N1", "VAG", [row("alpha", 1, { line: "a" })])
		await expect(lineOf(1, Date.now() + MAX_AGE_MS + 1000)).rejects.toThrow("старше суток")
	})

	test("строка без ref в корзину не кладётся", async () => {
		await saveLastPart("N1", "VAG", [row("alpha", 1)])
		await expect(lineOf(1)).rejects.toThrow("ref")
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
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
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

import { TOOL, bold, cyan, dim, heading, need, renderOffers } from "../sdk/index.ts"
import { limitOf } from "../core/args.ts"
import { emptyResult, resolveBrand } from "../core/brand.ts"
import { invoke } from "../core/invoke.ts"
import { saveLastPart } from "../core/lastpart.ts"
import { splitOffers } from "../core/merge.ts"
import { fanout, report } from "../core/partial.ts"
import { hint, providerCol } from "../core/render.ts"
import { parseOffers } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdPart(ctx: Ctx): Promise<Output> {
	const article = need(ctx.args[0], "артикул")
	const providers = await ctx.pick()
	// Бросает Ambiguous — её ловит и рисует app.ts.
	const resolved = await resolveBrand(providers, article, ctx.args[1], ctx.warn)
	const { brand, all, failures } = resolved

	if (!brand) return emptyResult(article, resolved, { brands: [], offers: [], analogs: [] }, ctx.warn)

	const brandsJson = all.map(b => ({
		brand: b.brand, article: b.article,
		...(b.name ? { name: b.name } : {}), ...(b.rating ? { rating: b.rating } : {}),
		providers: b.providers,
	}))

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
				renderOffers(exact, [providerCol]),
			]
			if (split.offers.length > exact.length) out.push(hint(`показано ${exact.length} из ${split.offers.length} — --limit <n>`))
			if (analogs) {
				out.push(heading("Аналоги"), extra.length ? renderOffers(extra, [providerCol], exact.length + 1) : dim("аналогов нет"))
			} else if (split.analogs.length) {
				out.push(hint("есть и аналоги — --analogs"))
			}
			out.push(hint(`${TOOL} basket add <#> [--qty <n>] — положить строку в корзину её сайта`))
			return out.join("\n")
		},
	}
}
```

- [ ] **Step 6: Подключить `part` и отрисовку `Ambiguous` в `src/app.ts`**

Импорты (`renderBrands` добавляется к уже имеющемуся импорту из `./sdk/index.ts`):

```ts
import { renderBrands } from "./sdk/index.ts"
import { cmdPart } from "./commands/part.ts"
import { Ambiguous } from "./core/errors.ts"
import { whereCol } from "./core/render.ts"
import type { MergedBrand } from "./core/merge.ts"
```

В таблицу команд добавить строку `part: cmdPart,`.

В `catch` заменить возврат текстовой ошибки на:

```ts
		const body = errorBody(e)
		const code = exitCode(body.error.code)
		if (json) return { stdout: `${JSON.stringify(body)}\n`, stderr, code }
		// «Уточни бренд» — не ошибка, а список: человеку нужна таблица с
		// колонкой «где», а не одна строка красным.
		const table = e instanceof Ambiguous ? `${renderBrands(e.brands, [whereCol<MergedBrand>()])}\n` : ""
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
- Consumes: `mergeProducts`, `parseProducts`, `renderProducts` и `need` из `sdk/index.ts`, `whereCol`/`hint`, `limitOf`/`pageOf`, `fanout`/`report`.
- Produces: `cmdSearch(ctx): Promise<Output>`; форма `--json`: `{query, items: (Product & {providers: string[]; prices: Record<string, number>})[], errors}`.

- [ ] **Step 1: Тест**

`test/commands/search.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
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

import { TOOL, need, renderProducts } from "../sdk/index.ts"
import { limitOf, pageOf } from "../core/args.ts"
import { invoke } from "../core/invoke.ts"
import { mergeProducts, type MergedProduct } from "../core/merge.ts"
import { fanout, report } from "../core/partial.ts"
import { hint, whereCol } from "../core/render.ts"
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
		render: () => [renderProducts(items, [whereCol<MergedProduct>()]), hint(`${TOOL} part <артикул> <бренд> — цены, сроки и наличие по строке`)].join("\n"),
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
- Consumes: `resolveBrand`/`emptyResult` из `brand.ts`, `parseReviews`, `renderReviews`/`heading`/`need` из `src/sdk/index.ts`, `fanout`/`report`.
- Produces: `cmdReviews(ctx): Promise<Output>`; форма `--json`: `{article, brand, providers: {<id>: Reviews}, errors}`.

- [ ] **Step 1: Тест**

`test/commands/reviews.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import type { Reviews } from "../../src/sdk/index.ts"

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

import { heading, need, renderReviews } from "../sdk/index.ts"
import { limitOf } from "../core/args.ts"
import { emptyResult, resolveBrand } from "../core/brand.ts"
import { invoke } from "../core/invoke.ts"
import { fanout, report } from "../core/partial.ts"
import { parseReviews } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdReviews(ctx: Ctx): Promise<Output> {
	const article = need(ctx.args[0], "артикул")
	const providers = await ctx.pick()
	const resolved = await resolveBrand(providers, article, ctx.args[1], ctx.warn)
	const { brand, failures } = resolved

	if (!brand) return emptyResult(article, resolved, { providers: {} }, ctx.warn)

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
- Modify: `src/app.ts` (команда `basket`)
- Test: `test/commands/basket.test.ts`

**Interfaces:**
- Consumes: `lineOf` из `lastpart.ts`, `one`/`qtyOf` из `args.ts`, `need`/`parseRef`/`renderBasket`/`basketTotal` из `sdk/index.ts`, `parseBasket`, `invoke`/`passNoise`, `fanout`/`report`.
- Produces: `cmdBasket(ctx): Promise<Output>`; форма `--json` списка: `{providers: {<id>: Basket}, total, errors}`, форма изменения: `{provider, basket}`.

- [ ] **Step 1: Тест**

`test/commands/basket.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV, accountStore } from "../../src/sdk/index.ts"
import { PROVIDERS_DIR_ENV } from "../../src/core/registry.ts"
import { LAST_PART_FILE } from "../../src/core/lastpart.ts"
import { writeJson } from "../../src/core/store.ts"
import type { Basket } from "../../src/sdk/index.ts"

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

Колонки `#` и `ID` рисует `renderBasket` из SDK — это осознанное расхождение
со спекой (§`basket` п.4 предлагает одну колонку `#`, показывающую и номер, и
`itemId`): у autodoc `itemId` длинный и склеенный, в одной ячейке с номером он
нечитаем, а `basket set <provider> <ID>` требует скопировать его целиком.
Расхождение записано в разделе «Отступления от спеки», а строку спеки правит
задача 15.

- [ ] **Step 3: `src/commands/basket.ts`**

```ts
// basket.ts — мультикорзина. Своей корзины у обёртки нет: каждая позиция
// лежит в корзине своего сайта, обёртка только показывает их вместе и
// пересылает изменения. `ref` для добавления непрозрачен: он пришёл от сайта
// в offers и уходит обратно как есть.

import { ProviderError, TOOL, basketTotal, bold, dim, money, need, parseRef, renderBasket } from "../sdk/index.ts"
import type { Basket } from "../sdk/index.ts"
import { one, qtyOf } from "../core/args.ts"
import { invoke, passNoise, type InvokeResult } from "../core/invoke.ts"
import { lineOf } from "../core/lastpart.ts"
import { fanout, report } from "../core/partial.ts"
import { hint } from "../core/render.ts"
import { parseBasket } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"

/** Заголовок блока: чья это корзина. Саму таблицу рисует renderBasket из SDK. */
const title = (id: string, b: Basket): string => bold(id) + (b.url ? dim(`  ${b.url}`) : "")

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
			...f.got.map(g => `${title(g.provider, g.value)}\n${renderBasket(g.value)}`),
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
		ref = parseRef(ctx.flags.ref)
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
	return { json: { provider: id, basket }, render: () => `${title(id, basket)}\n${renderBasket(basket)}` }
}
```

- [ ] **Step 4: Подключить в `src/app.ts`**

Импорт `import { cmdBasket } from "./commands/basket.ts"` и строка `basket: cmdBasket,` в таблице команд.

- [ ] **Step 5: Зелёные тесты**

Run: `bun test test/commands/basket.test.ts && bun run typecheck`
Expected: PASS, 11 тестов.

- [ ] **Step 6: Commit**

```bash
git add src/commands/basket.ts src/app.ts test/commands/basket.test.ts
git commit -m "feat(commands): multi-provider basket with add by row number

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 12: `garage` — локальный гараж

**Files:**
- Create: `src/core/garage.ts`
- Create: `src/commands/garage.ts`
- Modify: `src/core/render.ts` (`garageCols`)
- Modify: `src/app.ts` (команда `garage`)
- Test: `test/core/garage.test.ts`
- Test: `test/commands/garage.test.ts`

**Interfaces:**
- Consumes: `readJson`/`writeJson`, `brandKey`/`need`/`intFlag`/`positiveInt`/`renderCars` из `sdk/index.ts`.
- Produces: `GARAGE_FILE = "garage.json"`, типы `GarageCar`, `Garage`; `loadGarage()`, `saveGarage(g)`, `addCar(g, car): {garage, car}`, `removeCar(g, id)`, `setMain(g, id)`, `mergeImported(g, provider, cars): {garage, added, updated}` (её пишет Step 4, зовёт задача 13); `garageCols(g): Col<GarageCar>[]`; `cmdGarage(ctx)`.

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
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
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
import type { Car } from "../sdk/index.ts"
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

- [ ] **Step 5: Колонки гаража в `src/core/render.ts`**

Своей таблицы машин у обёртки нет: `renderCars` из SDK плюс две колонки.
Дописать в `src/core/render.ts`:

```ts
import type { Col } from "../sdk/index.ts"
import type { Garage, GarageCar } from "./garage.ts"

/** ★ — основная машина; «СВЯЗИ» — сайты, откуда машина импортирована. */
export const garageCols = (g: Garage): Col<GarageCar>[] => [
	{ head: "ID", cell: c => `${g.mainId === c.id ? yellow("★") : " "}${c.id}` },
	{ head: "СВЯЗИ", cell: c => dim(Object.keys(c.refs ?? {}).join(", ")) },
]
```

Таблица рисуется вызовом `renderCars(g.cars, garageCols(g))`.

- [ ] **Step 6: `src/commands/garage.ts`**

```ts
// garage.ts — гараж целиком локальный: ни одна из этих подкоманд не ходит в
// сеть. Импорт с сайта — отдельная подкоманда, и её пользователь зовёт сам.

import { ProviderError, TOOL, bold, dim, intFlag, need, positiveInt, renderCars } from "../sdk/index.ts"
import type { Flags } from "../sdk/index.ts"
import { addCar, loadGarage, removeCar, saveGarage, setMain } from "../core/garage.ts"
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
	const { garage, car } = addCar(await loadGarage(), {
		brand, model,
		modification: strFlag(ctx.flags, "modification"),
		year: intFlag("year", ctx.flags.year),
		engine: strFlag(ctx.flags, "engine"),
		vin: strFlag(ctx.flags, "vin"),
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
```

- [ ] **Step 7: Подключить в `src/app.ts`**

Импорт `import { cmdGarage } from "./commands/garage.ts"` и строка `garage: cmdGarage,` в таблице команд.

- [ ] **Step 8: Зелёные тесты**

Run: `bun test test/core/garage.test.ts test/commands/garage.test.ts && bun run typecheck`
Expected: PASS, 15 тестов.

- [ ] **Step 9: Commit**

```bash
git add src/core/garage.ts src/commands/garage.ts src/core/render.ts src/app.ts test/core/garage.test.ts test/commands/garage.test.ts
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
import type { Car } from "../../src/sdk/index.ts"

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
import { accountStore } from "../../src/sdk/index.ts"
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
import { mergeImported } from "../core/garage.ts"
import { invoke, passNoise } from "../core/invoke.ts"
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
		render: () => `${dim(`с ${p.id}: добавлено ${added}, дополнено ${updated}`)}\n${renderCars(garage.cars, garageCols(garage))}`,
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
- Modify: `src/app.ts` (`COMMAND_NAMES`)
- Modify: `src/main.ts`
- Test: `test/commands/passthrough.test.ts`

**Interfaces:**
- Consumes: `discover()` из `registry.ts`, `COMMAND_NAMES` из `app.ts`, `configDir()`/`CONFIG_DIR_ENV`/`yellow` из `sdk/index.ts`.
- Produces: `passthrough(argv: string[]): Promise<number | null>` — `null`, если первым словом стоит не провайдер или имя занято командой обёртки; `COMMAND_NAMES: string[]` в `app.ts`.

- [ ] **Step 1: Тест**

`test/commands/passthrough.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
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

import { CONFIG_DIR_ENV, TOOL, configDir, yellow } from "../sdk/index.ts"
import { COMMAND_NAMES } from "../app.ts"
import { discover } from "../core/registry.ts"

/** Имена, которые провайдеру не отдаются ни при каких обстоятельствах. */
const RESERVED = new Set([...COMMAND_NAMES, "help"])

/** Код возврата провайдера или null, если первым словом стоит не его id. */
export async function passthrough(argv: string[]): Promise<number | null> {
	const id = argv[0]
	if (!id || id.startsWith("-")) return null
	// Своя команда всегда старше: провайдер с именем команды обёртки
	// (исполняемый adoc-part в PATH) не должен молча перехватывать `adoc part`.
	if (RESERVED.has(id)) {
		process.stderr.write(`${yellow(`${TOOL}: провайдер «${id}» называется как команда обёртки — команда важнее; сам провайдер доступен как ${TOOL}-${id}`)}\n`)
		return null
	}
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

- [ ] **Step 4: `COMMAND_NAMES` в `src/app.ts`**

Рядом с таблицей команд:

```ts
/** Имена команд обёртки: их не отдаёт провайдеру проброс. */
export const COMMAND_NAMES = Object.keys(COMMANDS)
```

- [ ] **Step 5: `src/main.ts`**

```ts
#!/usr/bin/env bun
// adoc — агрегатор магазинов автозапчастей. Справка: adoc --help.

import { run } from "./app.ts"
import { passthrough } from "./commands/passthrough.ts"
import { emit } from "./sdk/index.ts"

const argv = process.argv.slice(2)

// Проброс идёт мимо run(): вывод провайдера — его собственный, обёртка его не
// читает, не переписывает и не буферизует.
const passed = await passthrough(argv)
if (passed !== null) process.exit(passed)

const r = await run(argv)
if (r.stderr) process.stderr.write(r.stderr)
await emit(process.stdout, r.stdout, r.code)
```

- [ ] **Step 6: Зелёные тесты**

Run: `bun test test/commands/passthrough.test.ts && bun run typecheck`
Expected: PASS, 8 тестов.

- [ ] **Step 7: Commit**

```bash
git add src/commands/passthrough.ts src/app.ts src/main.ts test/commands/passthrough.test.ts
git commit -m "feat(commands): passthrough of provider commands with inherited stdio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 15: README, скилл и правка спеки

**Files:**
- Modify: `README.md` (переписывается целиком)
- Modify: `skills/adoc/SKILL.md` (переписывается целиком)
- Modify: `docs/superpowers/specs/2026-09-01-multi-provider-design.md` (строка про колонки корзины)

**Interfaces:** нет.

- [ ] **Step 1: `README.md` целиком**

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

ПРОВАЙДЕР  #  БРЕНД  НАЗВАНИЕ  ЦЕНА    НАЛИЧИЕ  СРОК    ПРОДАВЕЦ  РЕЙТИНГ
armtek     1  VAG    Болт      380 ₽   3 шт     2 дня   armtek    4.5★ (10)
autodoc    2  VAG    Болт      407 ₽   12 шт    1 день  Москва    4.9★ (56)
```

Ни autodoc, ни armtek не документируют свой API, а `adoc` — неофициальный
клиент. Вся полученная информация может быть неточной, неполной и
устаревшей — [docs/autodoc-api.md](docs/autodoc-api.md),
[docs/armtek-api.md](docs/armtek-api.md).

## Установка

```sh
$ bun install -g github:pashokitsme/adoc
$ gh skill install pashokitsme/adoc adoc
```

Ставятся три бинаря: `adoc` — обёртка, `adoc-autodoc` и `adoc-armtek` —
провайдеры. Обычно нужен только первый.

## Команды

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

Флаг со значением пишется `--flag value` или `--flag=value`, и значение
обязательно: `--limit --json` — это `bad_args`, а не лимит «--json».
Переключатель значения не берёт: `--json=true` — то же, что `--json`,
`--json=false` — то же, что флага нет, всё остальное — `bad_args`.

Актуальный список всегда печатает сам бинарь: `adoc --help`, а по сайтам —
`adoc providers`.

## Порядок: артикул → бренд

Один артикул выпускают разные производители, и цена, срок и отзывы у них
разные. `adoc part <артикул>` сначала спрашивает у всех сайтов список брендов,
и если бренд не один — печатает таблицу вариантов с колонкой «ГДЕ» и выходит с
кодом `2`. Повтори с брендом: `adoc part n90954802 VAG`.

## Как это устроено

`adoc` — обёртка, каждый сайт — отдельная программа. Обёртка находит их сама:
встроенные лежат в `src/providers/*/main.ts`, чужие — это любые исполняемые
файлы `adoc-<id>` в `PATH`, на любом языке. Разговор всегда один и тот же:
`<провайдер> <команда> … --json`, ровно один JSON-объект в stdout. Таблицы
рисует обёртка.

Упавший сайт не отменяет выдачу: он уезжает жёлтой строкой в stderr и полем
`errors` в `--json`, остальные печатаются. Exit `1` — только когда не ответил
никто; exit `2` — «уточни бренд» со списком вариантов.

| код | когда |
|---|---|
| `0` | успех; пустой результат — тоже успех |
| `1` | ошибка; при агрегации — когда не ответил ни один сайт |
| `2` | бренд не определён однозначно; варианты — в `error.items` |

Свои файлы обёртки — `~/.config/adoc/garage.json` (гараж живёт локально, а не
на сайтах) и `last-part.json` (последняя выдача `part`, чтобы работало
`basket add <n>`; живёт сутки). Аккаунты пишут сами провайдеры:
`~/.config/adoc/accounts/<id>.json`, права `600`. Каталог переопределяется
`$ADOC_CONFIG_DIR`, иначе берётся `$XDG_CONFIG_HOME/adoc`.

## Авторизация

```sh
$ adoc login autodoc      # диалог в терминале, пароль без эха
$ adoc accounts           # кто авторизован у всех сайтов сразу
$ adoc logout autodoc     # забыть аккаунт
```

Пароль вводится только с терминала и на диск не пишется. `adoc login` не
печатает токены никогда; а вот у провайдера напрямую — `adoc autodoc login
--json` — в stdout уходит сохранённый аккаунт целиком, вместе с токенами: не
логируй этот вывод и никуда его не пересылай.

Имя, email и телефон обёртка показывает **как есть, без маскировки** — это
личные данные владельца аккаунта, он их и видит.

## Провайдер autodoc

Свои команды сверх контракта:

| команда | что делает | вход |
|---|---|---|
| `goods <categoryId> [--page <n>] [--sort <id>] [--limit <n>]` | товары внутри категории (id даёт `search`) | |
| `info <артикул> [brandId \| --brand <имя>]` | карточка: рейтинг, гистограмма, наличие | |
| `prices <артикул> [brandId \| --brand <имя>]` | сырые предложения продавцов (`originals`) | да |
| `analogs <артикул> [brandId \| --brand <имя>]` | сырые аналоги | да |
| `favorites [listId]` | избранное; без аргумента — списки | да |
| `orders` | заказы | да |
| `profile` | сводка по аккаунту | да |
| `garage [parts <carId> \| main <carId>]` | гараж сайта: список, подборка под машину, основная | да |
| `get <путь> [k=v ...] [--auth]` | произвольный GET к `web.autodoc.ru` | |
| `post <путь> [k=v ...] [--auth]` | произвольный POST к `web.autodoc.ru` | |

```sh
$ adoc autodoc goods 408
$ adoc autodoc info n90954802 --brand VAG
```

Есть вход без пароля: в консоли браузера на сайте с открытой сессией —
`copy(JSON.stringify(sessionStorage))`, вставка — в `adoc autodoc login
--paste`. Старый `token.json` от версии 1 переносится в
`accounts/autodoc.json` автоматически при первом запуске.

`brandId` у собственных команд необязателен: если производитель один, он
подставляется сам. Контрактные `offers` и `reviews` берут бренд только флагом
`--brand`.

## Провайдер armtek

| команда | что делает | вход |
|---|---|---|
| `info <артикул> --brand <имя>` | карточка: цены по складам, сроки, оценки | |
| `vstel [поиск]` | точки выдачи; текущая помечена ★ | |
| `raw <METHOD> <путь> [k=v ...] [--body <json>]` | произвольный вызов `rest/ru`: идёт с токеном аккаунта и любым методом, то есть умеет и писать | да |

Точка выдачи (`vstel`) — не украшение: от неё зависят цена, срок и наличие в
выдаче поиска. Без входа берётся московская по умолчанию, после `login` —
точка аккаунта.

```sh
$ adoc login armtek       # телефон 7XXXXXXXXXX или e-mail и пароль, ввод с терминала
$ ARMTEK_PHONE=7… ARMTEK_PASSWORD=… adoc armtek login   # без терминала, обе переменные обязательны
$ adoc armtek vstel москва
```

В `~/.config/adoc/accounts/armtek.json` (права `600`) лежат токены, сбытовая
организация, точка выдачи и коды клиента — персональных данных там нет,
профиль каждый раз спрашивается у сайта.

## Свой сайт

Провайдер — это исполняемый файл `adoc-<id>` в `PATH` на любом языке. От него
требуется отвечать на `describe`, `login`, `logout`, `whoami`, `search`,
`brands` и `offers` в форме [контракта](docs/contract.md), печатать с `--json`
ровно один JSON-объект в stdout и хранить свой аккаунт в
`$ADOC_CONFIG_DIR/accounts/<id>.json`. Обёртка подхватит его сама, без единой
правки в своём коде: `adoc providers` покажет его в списке, `adoc part` начнёт
его спрашивать. На TypeScript всё, кроме самого сайта, делает
[SDK](src/sdk/index.ts): `defineProvider` + `runProvider`.

## Протокол `--json`

С `--json` в stdout — ровно один JSON-объект и ничего больше; подсказки идут в
stderr. Это и есть язык, на котором обёртка говорит с провайдером.

```console
$ adoc autodoc brands 0986452041 --json
{"items":[{"brand":"BOSCH","article":"0986452041","name":"Фильтр масляный","rating":{"average":3.5714,"count":7},"extra":{"manufacturerId":30}}]}

$ adoc part 0986452041 --json | jq '.offers[0]'
{"provider":"armtek","article":"0986452041","brand":"BOSCH","price":380,"currency":"RUB","ref":{…}}
```

Ошибка приходит тем же способом — телом `{"error":{"code","message"}}` в stdout
(без `--json` — текстом в stderr). Коды: `auth`, `http`, `notfound`, `tty`,
`timeout`, `bad_args`, `internal` — все с кодом возврата `1`; `ambiguous` — с
`2` и списком брендов в `error.items`.

Формы ответов, типы и правила для провайдеров — [docs/contract.md](docs/contract.md).

## Разработка

```sh
$ bun test
$ bun run typecheck
```

Тесты не ходят в сеть и не трогают настоящий конфиг: `ADOC_CONFIG_DIR` уводит
конфиг во временный каталог, `ADOC_PROVIDERS_DIR` подменяет весь набор
провайдеров фикстурами из `test/fixtures/providers`, а провайдеры читают
записанные ответы вместо сети — autodoc через `ADOC_FIXTURES`, armtek через
подменённый транспорт (`test/fixtures/armtek-cli.ts`).

```sh
$ ADOC_FIXTURES=test/fixtures/autodoc/http adoc autodoc info n90954802
```

Имя файла фикстуры — метод и путь запроса, где `/` заменены на `_`:
`GET /api/goods-service/goods/info` → `GET__api_goods-service_goods_info.json`.
````

- [ ] **Step 2: `skills/adoc/SKILL.md` целиком**

````markdown
---
name: adoc
description: Use when looking up a car part by number or by name across parts shops (autodoc.ru, armtek.ru) — price, availability, delivery time, rating, reviews, analogues — or when working with the user's basket on those sites and their local garage. Also covers why those sites cannot be scraped and how to reach endpoints the CLI has no command for.
---
# adoc

CLI-агрегатор магазинов запчастей: одна команда спрашивает все подключённые
сайты сразу. Бинарь — `adoc`, справка `adoc --help`, список сайтов
`adoc providers`. Сейчас подключены autodoc.ru и armtek.ru; карты их API —
`docs/autodoc-api.md` и `docs/armtek-api.md` рядом со скиллом.

**Не лезь на эти сайты браузером.** Оба — Angular-SPA, не поднимаются ни
`ofetch`/obscura, ни Playwright: пустой `body`, вид «сайт мёртв». Данные только
через `adoc`.

## Что вызывать

| Задача | Команда |
|---|---|
| Есть артикул → цены, сроки, наличие везде | `adoc part <артикул> [бренд]` |
| То же плюс аналоги | `adoc part <артикул> [бренд] --analogs` |
| Только один сайт | `adoc part <артикул> --only autodoc` |
| Название детали → артикулы | `adoc search <текст>` |
| Отзывы и оценки | `adoc reviews <артикул> [бренд]` |
| Корзины всех сайтов | `adoc basket` |
| Положить строку из выдачи `part` | `adoc basket add <#> [--qty <n>]` |
| Убрать / изменить | `adoc basket rm <сайт> <ID>` · `adoc basket set <сайт> <ID> --qty <n>` |
| Машины пользователя | `adoc garage` |
| Кто авторизован | `adoc accounts` |
| Команда конкретного сайта | `adoc <сайт> <команда> …` |

Машине — `--json`: ровно один JSON-объект в stdout, дальше `jq`. Без него
таблица для человека; цвет гаснет сам при пайпе. Ошибка в `--json` приходит
телом `{"error":{"code":"…","message":"…"}}`, без `--json` — текстом в stderr.

Флаг со значением пишется `--flag value` или `--flag=value`, и значение
обязательно: `--limit --json` — это `bad_args`, а не лимит «--json».
Переключатель значения не берёт: `--json=true` — то же, что `--json`,
`--json=false` — то же, что флага нет.

## Обязательный порядок: артикул → бренд

Один артикул = много производителей, цена/отзывы/наличие разные. `adoc part`
сам делает первый шаг: спрашивает у всех сайтов, кто выпускает артикул.

Брендов оказалось несколько или названный не нашёлся → выход код **2** и тело
`{"error":{"code":"ambiguous","items":[…]}}` со списком, где у каждого варианта
в `extra.providers` — сайты, у которых он есть. Это не ошибка, а «уточни»:
бери бренд из `items` и повтори `adoc part <артикул> <бренд>`.

Коды: `0` — нашлось (пустой список тоже `0`), `2` — уточни бренд, `1` —
всё остальное.

## Частичный отказ — это не провал

Сайт, ответивший ошибкой, уезжает жёлтой строкой в stderr и полем `errors` в
`--json`; выдача остальных печатается как обычно. Смотри, что пришло, а не
только на stderr. Exit `1` при агрегации значит «не ответил никто».

Строка `armtek: нужен вход — adoc login armtek` означает ровно это: у сайта нет
аккаунта. Остальные сайты в этой же выдаче — рабочие.

## Корзина

`adoc basket` — корзины всех сайтов блоками, итог по каждому и общий. Колонка
`#` — номер строки, колонка `ID` — идентификатор позиции, его и передавать в
`basket set`/`basket rm` вместе с именем сайта.

`adoc basket add <#>` берёт строку из последней выдачи `adoc part` (она живёт
сутки в `~/.config/adoc/last-part.json`) и кладёт её в корзину того сайта, чьё
это предложение. Кэш протух — команда попросит повторить `part`, не выдумывай
номера. Для скриптов есть точная форма: `adoc basket add <сайт> --ref <json>`,
где `ref` — объект из `adoc part --json`, скопированный **как есть**.

## Гараж

`adoc garage` — спрашивай первым, когда пользователь говорит «моя машина» без
модели: там марка, модель, модификация, год, VIN. Гадать не надо. `★` —
основная машина. Гараж живёт локально, в `~/.config/adoc/garage.json`, а не на
сайтах; `adoc garage import <сайт>` забирает машины с сайта и сливает по VIN.

VIN и id машин — личные данные. Пользователю показывай, в сторонние запросы не
тащи, не публикуй.

## Авторизация — дело пользователя

Вход = пароль, вводит только человек: `adoc login <сайт>` читает с терминала
без эха. **Никогда не проси пароль в переписке и не суй в команду** —
аргументом он не принимается нарочно, чтоб не осел в истории шелла и в `ps`.

Нужен вход, аккаунта нет → скажи пользователю запустить `adoc login <сайт>`
самому, жди. Проверка безопасна: `adoc accounts` печатает по строке на сайт.
`ok:true` — аккаунт есть и токен годен; `ok:false` — входа нет или токен
протух, лечится тем же `login`. Email и телефон показываются **как есть, без
маскировки** — это личные данные пользователя: показал ему и забыл, наружу не
отправляй.

Файлы аккаунтов — `~/.config/adoc/accounts/<сайт>.json`, права 600. **Не читай
их и не печатай**: там токены. По той же причине не запускай `adoc <сайт>
login --json` — он печатает токены в stdout; у обёртки `adoc login` их не
печатает никогда.

## Ловушки

1. **`search` у autodoc отдаёт товары первой подходящей категории, а не всё
   подряд.** Остальные найденные категории — в `extra.categories`; по ним ходи
   `adoc autodoc goods <categoryId>`. Полнотекстового поиска по товарам нет —
   текст в `find-goods` даст `totalCount: 0`, это не баг.
2. **Оценки ≠ отзывы.** `4.91★ (56)` — это оценки, «отзывов: 35» — тексты.
   Оценка без текста в ленту не идёт. Не смешивай.
3. **У armtek цена, срок и наличие зависят от точки выдачи.** Текущую покажет
   `adoc armtek vstel`; без входа она московская по умолчанию.
4. **`describe` помечает `offers` как `auth: false`, но autodoc без токена
   всё равно отдаёт `auth`.** Верь коду ошибки, а не полю `auth`.
5. **Регистр параметров важен** в `adoc autodoc get`: почти везде PascalCase
   (`Article`, `ManufacturerId`, `PageNumber`), но поиск по артикулу —
   `article` со строчной. Сверяйся с `docs/autodoc-api.md`, не с интуицией.
6. **Артикул регистронезависим** — `n90954802` = `N90954802`, пробелы и дефисы
   тоже не важны, и у обёртки, и у сайтов.

## Свои команды сайтов

`adoc <сайт> <команда>` пробрасывается сайту как есть, вместе с `--help`.

- **autodoc**: `goods <categoryId>`, `info <артикул> [--brand]`, `prices`,
  `analogs`, `favorites`, `orders`, `profile`, `garage [parts|main]`,
  `get <путь>`, `post <путь>`. Эндпоинт без команды — через `get`/`post`.
- **armtek**: `info <артикул> --brand <имя>`, `vstel [поиск]`,
  `raw <METHOD> <путь>` (умеет и писать, нужен вход).

## Когда API молчит

404 или поле пропало → сайт поменял фронт. В `docs/autodoc-api.md` и
`docs/armtek-api.md` есть воспроизводимый способ снять карту заново: качай
чанки Angular-бандла, грепай пути, методы, имена параметров. Надёжнее, чем
гадать URL-ы.
````

- [ ] **Step 3: Правка спеки про колонки корзины**

В `docs/superpowers/specs/2026-09-01-multi-provider-design.md`, раздел
«`basket` — мультикорзина», заменить в пункте 1

```
   Вывод блоками по провайдерам: таблица `#  АРТИКУЛ  БРЕНД  НАЗВАНИЕ  ЦЕНА
   КОЛ  СУММА  СРОК`, итог по провайдеру, общий итог по всем внизу.
```

на

```
   Вывод блоками по провайдерам: таблица `#  ID  АРТИКУЛ  БРЕНД  НАЗВАНИЕ
   ЦЕНА  КОЛ  СУММА  СРОК`, итог по провайдеру, общий итог по всем внизу.
```

и в пункте 4

```
4. `basket set` и `basket rm` — проброс провайдеру с его `itemId` (колонка
   `#` в выводе корзины показывает и порядковый номер, и `itemId`).
```

на

```
4. `basket set` и `basket rm` — проброс провайдеру с его `itemId`: колонка `#`
   в выводе корзины — порядковый номер, колонка `ID` — сам `itemId`. Двумя
   колонками, а не одной: у autodoc `itemId` длинный и склеенный, в одной
   ячейке с номером он нечитаем, а копировать его приходится целиком.
```

- [ ] **Step 4: Сверить README со справкой**

Run: `bun test && bun run typecheck && bun src/main.ts --help`
Сверить список команд и флагов в выводе `--help` с таблицами README. Разошлись
— поправить README: справку читают чаще.

- [ ] **Step 5: Commit**

```bash
git add README.md skills/adoc/SKILL.md docs/superpowers/specs/2026-09-01-multi-provider-design.md
git commit -m "docs: README, skill and spec for the aggregator

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: `--help` из `describe`

**Files:**
- Create: `src/core/help.ts`
- Modify: `src/app.ts` (справка через `helpText`, `--json` без команды)
- Test: `test/commands/help.test.ts`
- Test: `test/core/app.test.ts` (набор провайдеров — фикстуры)

**Interfaces:**
- Consumes: `Loaded` из `registry.ts`, `TOOL`/`bold`/`dim` из `sdk/index.ts`.
- Produces: `helpText(loaded: Loaded | null): string`.

- [ ] **Step 1: Тест**

`test/commands/help.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run } from "../../src/app.ts"
import { CONFIG_DIR_ENV } from "../../src/sdk/index.ts"
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

import { TOOL, bold, dim } from "../sdk/index.ts"
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
Expected: PASS — все тесты плана A и плана B.

- [ ] **Step 6: Направить `test/core/app.test.ts` на фикстуры**

С этой задачи `run(["--help"])` снимает `describe`, а фикстуры провайдеров уже
есть (задача 3). Заменить в `beforeEach` пустой каталог на них:

```ts
env = {
	[CONFIG_DIR_ENV]: dir,
	[PROVIDERS_DIR_ENV]: join(import.meta.dir, "..", "fixtures", "providers"),
}
```

и дописать проверку, что справка теперь знает про сайты:

```ts
	test("справка перечисляет найденные сайты", async () => {
		const r = await run(["--help"])
		expect(r.stdout).toContain("alpha")
		expect(r.stdout).toContain("beta")
	})
```

Настоящих `autodoc`/`armtek`, настоящего `~/.config/adoc` и `PATH` ни один тест
плана после этого не касается: у каждого свои `ADOC_CONFIG_DIR` и
`ADOC_PROVIDERS_DIR`, и то же окружение уходит в `Bun.spawn`.

- [ ] **Step 7: Сверить справку с README**

Run: `bun src/main.ts --help`
Сверить список команд и флагов с таблицами README из задачи 15. Разошлись —
править `helpText`: README в этой задаче не трогается, он уже написан и
закоммичен отдельно.

- [ ] **Step 8: Commit**

```bash
git add src/core/help.ts src/app.ts test/commands/help.test.ts test/core/app.test.ts
git commit -m "feat(core): describe-driven help for the aggregator

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Контрактный тест встроенных провайдеров

**Files:**
- Test: `test/core/contract.test.ts`

**Interfaces:**
- Consumes: `invoke(bin, args, opts)` из `core/invoke.ts`, `parseDescribe`/`parseBrands`/`parseOffers` из `core/validate.ts`, `articleKey` и `accountStore` из `sdk/index.ts`.
- Produces: ничего — это проверка, а не код.

Спека §«Тесты» требует контрактного теста на каждого встроенного провайдера:
`describe` валиден по форме, `brands` и `offers` — тоже, и всё это без сети, на
записанных ответах. Проверяются настоящие `autodoc` и `armtek` — но тем же
способом, каким с ними говорит агрегатор: `invoke` и валидаторы контракта. Это
единственный тест плана, который запускает не фикстуру, а живой провайдер.

Фикстурный режим у провайдеров разный, и это часть их устройства: у autodoc
свой `call()` с `ADOC_FIXTURES` (каталог записанных ответов), у armtek —
подменяемый транспорт, поэтому он гоняется через `test/fixtures/armtek-cli.ts`
и `ARMTEK_FIXTURES` (карта «кусок пути или queryType → файл»).

- [ ] **Step 1: Тест**

`test/core/contract.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DIR_ENV, accountStore, articleKey } from "../../src/sdk/index.ts"
import { invoke } from "../../src/core/invoke.ts"
import { parseBrands, parseDescribe, parseOffers } from "../../src/core/validate.ts"

const root = join(import.meta.dir, "..", "..")
const armtekFix = (name: string): string => join(root, "test", "fixtures", "armtek", name)

/** Гостевой токен нужен armtek на любой запрос; точная выдача — одна страница. */
const armtekRoutes = {
	"auth-microservice/v1/guest": armtekFix("guest-token.json"),
	"queryType:2": armtekFix("search-exact-bosch.json"),
}

type Case = {
	id: string
	bin: string[]
	env: Record<string, string>
	article: string
	brand: string
	/** Нужен ли провайдеру аккаунт, чтобы отдать offers. */
	account?: () => Promise<void>
}

const cases: Case[] = [
	{
		id: "autodoc",
		bin: ["bun", join(root, "src", "providers", "autodoc", "main.ts")],
		env: { ADOC_FIXTURES: join(root, "test", "fixtures", "autodoc", "http") },
		article: "n90954802",
		brand: "VAG",
		// originals без токена отвечает auth — токен фиктивный, сеть всё равно
		// подменена фикстурами.
		account: () => accountStore("autodoc").save({ access_token: "a.b.c", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600 }),
	},
	{
		id: "armtek",
		bin: ["bun", join(root, "test", "fixtures", "armtek-cli.ts")],
		env: { ARMTEK_FIXTURES: JSON.stringify(armtekRoutes) },
		article: "0986452041",
		brand: "BOSCH",
	},
]

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "adoc-contract-")); process.env[CONFIG_DIR_ENV] = dir })
afterEach(async () => { delete process.env[CONFIG_DIR_ENV]; await rm(dir, { recursive: true, force: true }) })

for (const c of cases) {
	describe(`контракт: ${c.id}`, () => {
		test("describe проходит валидацию агрегатора", async () => {
			const r = await invoke(c.bin, ["describe"], { env: c.env })
			expect(r.ok).toBe(true)
			if (!r.ok) return
			const d = parseDescribe(r.json, c.id)
			expect(d.contract).toBe(1)
			expect(d.commands.map(x => x.name)).toEqual(expect.arrayContaining(["login", "logout", "whoami", "search", "brands", "offers"]))
			// Подкоманда именуется двумя словами через пробел — на это имя
			// агрегатор ориентируется в справке.
			if (d.capabilities.includes("basket")) expect(d.commands.map(x => x.name)).toContain("basket add")
		})

		test("brands: форма контракта и тот же артикул", async () => {
			const r = await invoke(c.bin, ["brands", c.article], { env: c.env })
			expect(r.ok).toBe(true)
			if (!r.ok) return
			const items = parseBrands(r.json, c.id)
			expect(items.length).toBeGreaterThan(0)
			expect(items.some(b => articleKey(b.article) === articleKey(c.article))).toBe(true)
			expect(items.some(b => b.brand === c.brand)).toBe(true)
		})

		test("offers: форма контракта, цена и ref для корзины", async () => {
			await c.account?.()
			const r = await invoke(c.bin, ["offers", c.article, "--brand", c.brand], { env: c.env })
			expect(r.ok).toBe(true)
			if (!r.ok) return
			const items = parseOffers(r.json, c.id)
			expect(items.length).toBeGreaterThan(0)
			for (const o of items) {
				expect(o.price).toBeGreaterThan(0)
				expect(o.currency).toBe("RUB")
				// Провайдер с capability basket обязан отдавать ref в каждом
				// предложении: без него `adoc basket add` нечем позвать.
				expect(o.ref).toBeDefined()
			}
		})

		test("неизвестная команда — bad_args, а не молчание", async () => {
			const r = await invoke(c.bin, ["нетакой"], { env: c.env })
			expect(r.ok).toBe(false)
			if (r.ok) return
			expect(r.error.code).toBe("bad_args")
		})
	})
}
```

- [ ] **Step 2: Запустить**

Run: `bun test test/core/contract.test.ts`
Expected: PASS, 8 тестов (по четыре на провайдера). Тест падает ровно в двух
случаях: провайдер сломал форму ответа или у него пропал фикстурный режим —
оба раза это настоящая поломка контракта, а не теста.

Если `offers` у autodoc отвечает `auth` — значит перестал работать фиктивный
токен: в фикстурном режиме `auth.ts` не ходит за refresh (`if
(process.env.ADOC_FIXTURES) return null`), проверять надо его, а не тест.

- [ ] **Step 3: Commit**

```bash
git add test/core/contract.test.ts
git commit -m "test(core): contract test for bundled providers on recorded fixtures

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
14. Положить в `PATH` пустой исполняемый `adoc-part` и убедиться, что `adoc part n90954802` по-прежнему выполняет команду обёртки, а в stderr одна жёлтая строка про совпадение имён.

## Самопроверка плана

**1. Покрытие спеки.**

| раздел спеки | где закрыт |
|---|---|
| Архитектура: три бинаря, `bin` в package.json | задача 1 |
| Обнаружение провайдеров: встроенные, `adoc-*` в PATH, приоритет встроенного | задача 3 |
| `adoc providers` с версией контракта, capabilities и статусом аккаунта; битый `describe` не в агрегации | задачи 3, 6 |
| Вызов провайдера: spawn, `--json`, мусор в stdout с предупреждением, stderr наружу (включая `describe`), stdin только для login, таймаут 30 с и SIGTERM, перенос exit-кода, параллельность | задачи 4, 5 |
| Хранилище: `garage.json`, `last-part.json`, перечисление и удаление `accounts/*.json`, атомарная запись | задачи 2, 8, 12 |
| `part`: ключ артикула, склейка брендов, exit 2, свои написания бренда сайтам, точные против аналогов, сортировка, `--limit`, форма `--json` | задачи 7, 8 |
| `search`: склейка по (артикул, бренд), порядок, минимальная цена, подсказка про `part`, форма `--json` | задачи 7, 9 |
| Частичный отказ: жёлтая строка, `errors`, exit 1 только когда упали все, exit 2 только за бренд | задачи 5, 7 (`emptyResult`), 8–11 |
| `basket`: блоки по сайтам, итоги, `add <n>` из `last-part.json`, протухший кэш, `add <provider> --ref`, `set`/`rm`, печать тронутой корзины | задача 11 |
| `reviews`: те же шаги брендов, блоки по сайтам, форма `--json` | задача 10 |
| `garage`: список со звездой, `add`, `main`, `rm`, `import` со слиянием по VIN | задачи 12, 13 |
| `login`/`logout`/`accounts`/`whoami` | задача 6 |
| `<provider> <cmd> …` — проброс, включая `--help`; имя команды обёртки провайдеру не отдаётся | задача 14 |
| `--help`: справка обёртки плюс строка на провайдера из `describe` | задача 16 |
| Флаги `--json`, `--only`, `--skip`, `--limit`, `--page`, `--analogs` | задачи 1, 3, 8, 9 |
| Тесты: `core/part`, `core/search`, `core/invoke`, `core/garage`, `core/basket`, фикстурный провайдер | задачи 3–13 (`core/part` и `core/search` разложены на `merge.test.ts` плюс `commands/part.test.ts` и `commands/search.test.ts`) |
| Тесты: контрактный тест встроенных провайдеров на фикстурах | задача 17 |
| Документация: README, SKILL и правка спеки | задача 15 |

Не закрыто нарочно и почему:

- **Миграция `token.json` → `accounts/autodoc.json`** — сделана в плане A внутри провайдера autodoc (`migrateLegacyToken`), обёртке добавлять нечего.
- **`docs/contract.md` и `docs/armtek-api.md`** — написаны планами A и C; план B их только читает.
- **Импорт гаража «с сайтов, у которых он есть»** во множественном числе — команда адресная, по одному сайту за раз (`garage import <provider>`), как и в таблице команд спеки.

**2. Поиск заглушек.** Ни одного «TBD», «аналогично задаче N», «добавить обработку ошибок». Все шаги с кодом содержат код целиком — включая помощники фикстуры (`auth`, `load`, `store`), которых не хватало в первой редакции. Задача 15 больше не отсылает к существующему тексту: README и SKILL выписаны целиком, как код.

**3. Согласованность типов.** Сквозная проверка имён:

- `ProviderEntry`/`Provider`/`BadProvider`/`Loaded` объявлены в задаче 3 и в этих же именах используются задачами 4, 5, 6, 14, 16.
- `invoke(bin, args, opts)` берёт `string[]`, а не `Provider`, — чтобы `registry.ts` мог его звать без цикла импортов; `InvokeOpts` в блоке Interfaces задачи 4 совпадает с кодом (`timeoutMs`, `interactive`, `env`).
- `InvokeResult` — размеченное объединение по `ok`; все потребители (`fanout`, `afterChange`, `cmdLogin`, `cmdLogout`, `importGarage`, контрактный тест) проверяют `r.ok` до чтения `r.json`.
- `passNoise` живёт в `invoke.ts` (задача 4) — там же, где `InvokeResult`, и потому доступна `registry.load()`, которая идёт раньше `partial.ts`.
- `Fanout<T>` с полями `got`/`failures`/`asked` — одно имя у `partial.ts`, `brand.ts`, `part`, `search`, `reviews`, `basket`, `accounts`; `Resolved.step` — тот же тип.
- `OfferRow = Offer & {provider}` объявлен в `merge.ts`; `renderOffers(rows, [providerCol])`, `saveLastPart` и `splitOffers` говорят про него же.
- `MergedBrand.spelling` читается только в `part` и `reviews`, оба через `brand.spelling[p.id]!` после фильтра `brand.providers.includes(p.id)` — ключ гарантированно есть.
- `Col<T>` из `sdk/render.ts` — единственный способ добавить колонку; `providerCol`, `whereCol<T>()`, `garageCols(g)` возвращают именно его.
- `Ctx.pick(cap?)` и `Ctx.load()` — единственные способы добраться до провайдеров; `one(ctx, id, cap?)` ходит через `ctx.load()`.
- `Output = {json, render, code?}` — форма возврата всех девяти команд и `emptyResult`; печатает только `app.ts`.
- Имена файлов-констант: `LAST_PART_FILE`, `GARAGE_FILE`, `PROVIDERS_DIR_ENV`, `INVOKE_TIMEOUT_MS`, `MAX_AGE_MS`, `COMMAND_NAMES` — объявлены по одному разу и импортируются из своего модуля.

**4. Что изменилось после предполётной проверки** (`.superpowers/sdd/2026-09-02-b-aggregator/preflight.md`):

- Фикстура `makeFake` получила недостающие `auth`/`load`/`store`, из-за которых её импорты висели неиспользованными, а задача 11 не собиралась без дописывания руками (F1).
- `parseDescribe` проверяет обязательные поля до `commands`, и тексты ошибок совпадают с тем, что ждут тесты задач 3 и 4 (F2).
- `test/fixtures/sleepy.ts` стал модулем — `tsc` больше не падает TS1375 (F3), и он вынесен из каталога провайдеров, чтобы не тормозить `load()`.
- Блок Interfaces задачи 4 приведён к коду: `env?` в `InvokeOpts` (F4). Задача 12 объявляет `mergeImported` в Produces (F5).
- `test/core/app.test.ts` с первого же теста работает во временном `ADOC_CONFIG_DIR` и своём `ADOC_PROVIDERS_DIR`; после задачи 16 он смотрит на фикстуры. Ни один тест плана не касается настоящих провайдеров, настоящего конфига и `PATH` (F6).
- README принадлежит задаче 15 и только ей; задача 16 его не коммитит (F7).
- Пять почти дословных копий рендеров исчезли: `renderProducts`/`renderBrands`/`renderOffers`/`renderBasket`/`renderCars` принимают `cols`, а обёртка передаёт свои колонки (F8). `garageTable`, `basketBlock`, `productsTable`, `offersTable`, `brandsWhereTable` не заводятся.
- `parseRef`, `need` и `intFlag` переехали в `sdk/cli.ts` и переиспользуются вместо копий в `core/args.ts` (F9).
- Общий блок «ничего не нашлось» вынесен в `brand.ts` как `emptyResult`, код возврата считает `allFailed`, а не арифметика в команде (F10).
- Удаление аккаунта отличает ENOENT от прочих ошибок: `logout` больше не может отрапортовать успех на неудалённых токенах (F11). Мёртвый `removeFile` убран.
- `registry.load(warn)` прогоняет ответ `describe` через `passNoise` — предупреждения и stderr провайдера доходят до человека (F12).
- Все `expect(...).rejects` в задаче 8 идут с `await` (F13).
- `cmdLogin` объявлен исключением из инварианта «app.ts ничего не печатает», а тело `login` теперь не разбирается вовсе: успех берётся из кода возврата, `display` — отдельным `whoami` (F14). Добавлен тест «токен не уходит ни в stdout, ни в stderr».
- Задача 15 выписывает README и SKILL дословно и правит строку спеки про колонки корзины (F15, F17); само расхождение записано в разделе «Отступления от спеки».
- Появилась задача 17 — контрактный тест встроенных провайдеров на записанных ответах, которого требует спека §«Тесты» (F16).
- Проброс не отдаёт провайдеру имя команды обёртки и говорит об этом в stderr; на это есть тест (F18).
- `providersTable` и `accountsTable` покрыты тестами задачи 5 (F19).
- Правило импортов: `src/core/`, `src/commands/`, `src/app.ts` и `src/main.ts` берут SDK только через `sdk/index.ts`, и задача 1 доводит его до полной поверхности (F20).

## Что дальше

- **План C** — новые провайдеры по тому же контракту; агрегатор для них не меняется. Если меняется — значит, контракт неполон, и правится он, а не `src/core/`.

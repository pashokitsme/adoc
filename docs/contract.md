# Контракт провайдера v1

Провайдер — самостоятельный исполняемый файл `adoc-<id>` (`<id>` — короткое имя
сайта: `autodoc`, `armtek`). Агрегатор `adoc` не знает о сайте ничего, кроме
этого документа: он находит провайдера, запускает его с флагом `--json` и
читает stdout.

Версия контракта — `1` (`CONTRACT_VERSION` в `src/sdk/contract.ts`); провайдер
обязан отдавать её в `describe.contract`.

Эталон форм ответов — `src/sdk/contract.ts`; он целиком приведён ниже, чтобы
этот документ был самодостаточен. Провайдеру на TypeScript всё, что описано
здесь, даёт SDK (`src/sdk/index.ts`): argv, `--json`, рендер, файл аккаунта,
exit-коды, `describe`. Провайдер на другом языке реализует протокол сам.

## Протокол

Агрегатор зовёт:

```
adoc-<id> <команда> [аргументы] [флаги] --json
```

- С `--json` в **stdout** — ровно один JSON-объект и перевод строки, больше
  ничего. Всё человеческое (подсказки, прогресс, предупреждения) — в **stderr**.
- Без `--json` провайдер печатает что угодно для человека: это его собственный
  интерфейс, агрегатор его не читает и таблицы для общей выдачи рисует сам.
- Ошибка тоже приходит объектом: с `--json` тело `{"error":{…}}` печатается в
  stdout, без `--json` — текст в stderr. Exit-код в обоих случаях один и тот же.
- stdin наследуется только для `login`; остальные команды не должны его ждать.
- Каталог конфига агрегатор передаёт детям переменной `ADOC_CONFIG_DIR`.

### Флаги контракта

| флаг | значение | где |
|---|---|---|
| `--json` | нет (переключатель) | все команды |
| `--brand <имя>` | да | `offers`, `reviews` |
| `--page <n>` | да | `search`, `reviews`; по умолчанию `1` |
| `--limit <n>` | да | `search`, `reviews`; по умолчанию `10` |
| `--analogs` | нет (переключатель) | `offers`, при capability `analogs` |
| `--qty <n>` | да | `basket add`, `basket set` |
| `--ref <json>` | да | `basket add` |

Флаг со значением пишется **`--flag value` или `--flag=value`**. Разбор argv
не угадывает: флаг из списка «со значением» забирает следующий токен, каким бы
он ни был. `search болт --page --json` съест `--json` как значение страницы и
вернёт `bad_args: --page: нужно неотрицательное число, а не «--json»` — причём
текстом в stderr, потому что `--json` до флага так и не доехал. Ставь
переключатели перед флагами со значением или пиши `--page=2`.

`--page` и `--limit` разбираются до вызова команды: неотрицательное конечное
число, иначе `bad_args` на любой команде.

### Справка

Вызов без аргументов или с `--help` / `-h` печатает справку в stdout и выходит
с `0`. Тот же вызов с `--json` — это ошибка `bad_args` (exit `1`): машине
список команд отдаёт `describe --json`, а не `--help`.

## Обязательные команды

| команда | ответ | тип |
|---|---|---|
| `describe` | `{contract, id, name, site, capabilities, commands}` | `Describe` |
| `login` | `{account, display}` | `LoginResult` |
| `logout` | `{ok: true, had: boolean}` | — |
| `whoami` | `{ok: false}` или `{ok: true, display}` | `WhoamiResult` |
| `search <текст> [--page <n>] [--limit <n>]` | `{items, total?, extra?}` | `SearchResult` |
| `brands <артикул>` | `{items}` | `BrandsResult` |
| `offers <артикул> --brand <имя> [--analogs]` | `{items}` | `OffersResult` |

`login` обычно ведёт диалог через терминал (логин, пароль без эха). Если
провайдеру нужно что-то спросить, а tty нет, он обязан ответить
`{"error":{"code":"tty"}}` и не спрашивать ничего. Пароль не принимается
аргументом — он осел бы в истории шелла и в `ps`. Терминал нужен именно
вопросу, а не команде: `tty` летит из `ctx.prompt()`/`ctx.secret()`, поэтому
провайдер, который берёт учётку иначе (переменные окружения, файл), входит и
без терминала.

> **`login --json` печатает поле `account` целиком — то есть токены.** Так
> задумано: агрегатору нужна копия того, что записано в файл аккаунта. Это
> секрет: не логируй вывод `login --json`, не показывай его человеку и не
> клади в файл без прав `600`. Для проверки «кто вошёл» есть `whoami`, он
> токенов не печатает.

`logout` забывает аккаунт; `had` говорит, был ли он вообще. Команда не ошибка,
даже когда забывать нечего.

`whoami` отвечает про пригодность входа, а не про наличие файла: `ok: true` —
аккаунт есть и провайдер считает его рабочим (проверяет токен, если умеет);
`ok: false` — аккаунта нет или токен не годится. Команда не ходит в сеть без
нужды и не удаляет аккаунт по собственной инициативе; но проверка токена может
его обновить, а значит переписать файл аккаунта или сбросить его, если сайт
отверг refresh.

`brands` — первый шаг поиска по партномеру: кто выпускает этот артикул.
`offers` — второй: предложения конкретного бренда. Разделение обязательно,
потому что у одного артикула бывает несколько производителей с разной ценой,
разными отзывами и разным наличием.

## Необязательные команды и capabilities

`describe.capabilities` — что провайдер умеет сверх обязательного минимума.
Объявил capability — обязан отвечать на её команды.

| capability | команда | ответ |
|---|---|---|
| `reviews` | `reviews <артикул> --brand <имя> [--page <n>] [--limit <n>]` | `Reviews` |
| `garage` | `garage export` | `{cars}` (`CarsResult`) |
| `analogs` | флаг `--analogs` у `offers` поддержан | — |
| `basket` | `basket` | `Basket` |
| `basket` | `basket add --ref <json> [--qty <n>]` | `Basket` |
| `basket` | `basket set <itemId> --qty <n>` | `Basket` |
| `basket` | `basket rm <itemId>` | `Basket` |

Провайдер с `basket` обязан отдавать `ref` в каждом `Offer`: это непрозрачный
JSON-объект, который `basket add` принимает обратно как есть. Что внутри — дело
провайдера (у autodoc это идентификаторы прайс-строки и партнёра). Все четыре
операции корзины возвращают корзину целиком после изменения, чтобы агрегатору
не нужен был второй вызов.

Любая другая команда — провайдерская: она попадает в `describe.commands` со
своими `usage`/`about`/`auth`, и агрегатор пробрасывает её как есть, не
разбирая ответ.

## `describe`

```json
{"contract":1,"id":"autodoc","name":"Autodoc","site":"https://www.autodoc.ru",
 "capabilities":["reviews","garage","analogs","basket"],
 "commands":[{"name":"brands","usage":"brands <артикул>","about":"кто выпускает артикул","auth":false},
             {"name":"basket add","usage":"basket add --ref <json> [--qty <n>]","about":"положить предложение (ref из offers)","auth":true}]}
```

`commands` — контрактные команды плюс свои, каждая с `name`, `usage`, `about`,
`auth`. `describe` обязан работать без входа и без сети.

`name` подкоманды — полное имя в два слова через пробел, ровно как её зовут:
`garage export`, `basket add`, `basket set`, `basket rm`. Отдельной записи
`garage` в списке нет, а `export`/`add`/`set`/`rm` сами по себе именами команд
не бывают; `basket` без второго слова — это команда «показать корзину».

Поле `auth` — **информационное**: подсказка для справки и для агрегатора, а не
гарантия. Провайдер может потребовать вход и на команде, помеченной
`auth: false`; тогда он отвечает `{"error":{"code":"auth"}}`. Так и устроен
autodoc: `offers` в его `describe` идёт с `auth: false`, но эндпоинт
предложений без токена отдаёт 401, и команда честно возвращает `auth`.
Единственный надёжный признак «нужен вход» — код ошибки, а не `describe`.

## Типы

Ниже — `src/sdk/contract.ts` целиком. Все необязательные поля действительно
необязательны: агрегатор не падает без них, но и не выдумывает их за
провайдера. `extra` — место для сырых полей сайта; агрегатор их не трогает и
не интерпретирует, но пробрасывает в `--json`.

```ts
// contract.ts — контракт провайдера v1. Единственный источник правды по формам
// ответов — docs/contract.md; здесь то же самое типами. Агрегатор импортирует
// отсюда только типы.

export const CONTRACT_VERSION = 1 as const

export type Capability = "reviews" | "garage" | "analogs" | "basket"

export type Rating = { average: number; count: number }

/** Поля как их отдаёт сайт: провайдер их не маскирует, маскирует только рендер. */
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

## Ошибки и exit-коды

Тело ошибки — `ErrorBody`:

```json
{"error":{"code":"auth","message":"…"}}
```

`items` добавляется только к `ambiguous`.

| код | exit | смысл |
|---|---|---|
| `auth` | 1 | нужен вход; агрегатор подскажет `adoc login <id>` |
| `http` | 1 | сайт ответил ошибкой; `message` содержит статус и кусок тела |
| `notfound` | 1 | артикул, бренд или позиция не найдены |
| `tty` | 1 | `login` без терминала |
| `timeout` | 1 | превышен собственный таймаут провайдера |
| `bad_args` | 1 | неверные аргументы или неизвестная команда |
| `internal` | 1 | всё остальное: баг провайдера, неожиданное исключение |
| `ambiguous` | **2** | бренд не определён однозначно; `items: BrandHit[]` — из чего выбирать |

Успех — exit `0`. **Пустой результат — не ошибка**: `{"items":[]}` и exit `0`.
Ошибка — только когда ответить нельзя.

`ambiguous` — единственный код с exit `2`: это «уточни», а не «сломалось».
Провайдер кладёт в `items` варианты брендов (у autodoc — с
`extra.manufacturerId`), агрегатор показывает их человеку.

### Как SDK превращает исключение в код

Порядок в `runProvider` — первое совпадение выигрывает:

1. `ProviderError` (в том числе брошенный самим SDK — `tty`, `bad_args`,
   `timeout` из `sdk/http.ts`) — берётся как есть, со своим кодом и `items`.
2. `mapError` провайдера, если он объявлен. Вернул `ProviderError` — он и
   идёт наружу; вернул `null` — разбор продолжается.
3. `HttpError` из `sdk/http.ts` → код `http` с текстом ошибки.
4. Всё остальное → `internal` с `message` исключения.

Отсюда правило для своего маппера: превращай ошибку своего API в
`auth`/`notfound`/`http` сам, иначе она уедет в `internal`. Так делает autodoc:
401 → `auth`, 404 → `notfound`, прочее → `http`.

## Правила для провайдеров

- **Артикул на входе — в любом виде.** `n90954802`, `N90954802`, `N 909 548 02`
  — одно и то же. Приведение к форме сайта — забота провайдера. В ответах
  артикул отдаётся так, как его вернул сайт.
- **`brand` в ответах — как показывает сайт**, без обрезки и нормализации.
  Склейку между сайтами делает агрегатор (`articleKey`/`brandKey`).
- **`display` — как отдаёт сайт**: полные имя, email и телефон, без маскировки.
  Провайдер ничего не прячет; решает, что показать человеку, тот, кто рисует
  вывод. Это личные данные — не логируй их и не отправляй наружу.
- **Файл аккаунта принадлежит провайдеру.** Он создаёт его в `login`, читает и
  обновляет (refresh-токены) сам, права `600`, и удаляет по `logout`. Агрегатор
  только перечисляет файлы в `accounts/`. Содержимое непрозрачно: поле
  `account` в ответе `login` — копия того, что записано.
- **Пароли на диск не пишутся** и не принимаются аргументом командной строки.
- **`--json` означает: ни строки в stdout кроме одного JSON-объекта.**
  Подсказки, предупреждения и прогресс — в stderr.
- **`--json` принимает любая команда** — и контрактная, и своя.
- Провайдер обязан завершаться сам: свой таймаут на сеть обязателен, иначе
  агрегатор снимет его по SIGTERM через 30 с.

## Файл аккаунта

```
<конфиг>/accounts/<id>.json     права 600
```

Каталог конфига: `$ADOC_CONFIG_DIR`, иначе `$XDG_CONFIG_HOME/adoc`, иначе
`~/.config/adoc`. Агрегатор всегда передаёт `ADOC_CONFIG_DIR` детям, так что
провайдер должен читать именно эту переменную первой.

Формат содержимого — дело провайдера (у autodoc это `{access_token,
refresh_token, expires_at}`). `logout` файл удаляет.

## Примеры

Кто выпускает артикул:

```console
$ adoc-autodoc brands n90954802 --json
{"items":[{"brand":"VAG","article":"N90954802","name":"Болт","rating":{"average":4.9107,"count":56},"images":["https://images.autodoc.ru/goods/657/N90954802/med_00_657_N90954802_cdede454-e15d-4fdc-a8e8-22fdf16642fa.webp"],"extra":{"manufacturerId":657}}]}
```

Предложения без входа — ошибка `auth`, exit `1`:

```console
$ adoc-autodoc offers n90954802 --brand VAG --json
{"error":{"code":"auth","message":"/api/price-service/price-list/originals: нужен вход — запусти `adoc login`"}}
$ echo $?
1
```

Бренд не определён — `ambiguous`, exit `2`, варианты в `items`:

```console
$ adoc-autodoc offers 0986452041 --brand NOSUCH --json
{"error":{"code":"ambiguous","message":"бренда «NOSUCH» у артикула нет — выбери из списка","items":[{"brand":"BOSCH","article":"0986452041","name":"Фильтр масляный","extra":{"manufacturerId":30}},{"brand":"TOYOTA","article":"0986452041","name":"","extra":{"manufacturerId":579}}]}}
$ echo $?
2
```

Ничего не нашлось — не ошибка:

```console
$ adoc-autodoc brands zzzz999 --json
{"items":[]}
$ echo $?
0
```

## Как написать провайдера

### На TypeScript

Берёшь SDK: `defineProvider` описывает сайт, `runProvider` делает из описания
CLI. Типы обязательны — объявил capability `basket`, но не реализовал
`basket` — ошибка компиляции.

```ts
// Провайдер-заглушка: без сети, всё в памяти. Гоняется как отдельный процесс.
import { HttpError, ProviderError, defineProvider, runProvider } from "../../src/sdk/index.ts"
import type { Basket, Offer } from "../../src/sdk/contract.ts"

type Account = { token: string; user: string }

const offer: Offer = { article: "N1", brand: "VAG", name: "Болт", price: 407, currency: "RUB", quantity: 3, deliveryDays: 2, ref: { priceId: 7 } }
let basket: Basket = { items: [], currency: "RUB" }

export const fake = defineProvider<Account, ["reviews", "garage", "basket"]>({
	id: "fake", name: "Fake", site: "https://fake.example",
	capabilities: ["reviews", "garage", "basket"],
	valueFlags: ["echo"],

	// FAKE_LOGIN/FAKE_PASSWORD — вход без терминала: так живут провайдеры,
	// которые берут учётку из окружения (armtek), и так проверяется, что
	// tty требуется вопросу, а не команде login.
	login: async ctx => {
		const user = process.env.FAKE_LOGIN ?? await ctx.prompt("Логин > ")
		const password = process.env.FAKE_PASSWORD ?? await ctx.secret("Пароль > ")
		if (password !== "pw") throw new ProviderError("auth", "Логин или пароль не подошли")
		return { account: { token: "t-" + user, user }, display: { name: user } }
	},
// …
```

Дальше — `whoami`, `search`, `brands`, `offers` и, по capabilities, `reviews`,
`garageExport`, `basket`; свои команды — в `commands`. Полный рабочий пример:
`test/fixtures/fake-provider.ts` (провайдер без сети, на нём гоняются тесты
SDK). Публичная поверхность SDK — `src/sdk/index.ts`:

- `defineProvider`, `runProvider` — описание и запуск;
- `Ctx`, `ProviderSpec`, `BasketOps`, `ProviderCommand`, `CommandResult` — типы
  объявления: контекст вызова, готовое описание провайдера, четыре операции
  корзины, своя команда и её ответ (`{json, render?}`);
- `ProviderError`, `ErrorMapper` — ошибки контракта;
- `HttpError`, `fetchJson` — fetch с таймаутом (пользоваться необязательно);
- `articleKey`, `brandKey` — нормализация для склейки;
- `accountStore`, `configDir`, `CONFIG_DIR_ENV`, `TOOL` — файл аккаунта;
- `render` — таблицы и цвета для вывода человеку;
- все типы из `contract.ts`.

Контекст вызова `ctx`: `ctx.account` (уже прочитанный аккаунт или `null`),
`ctx.saveAccount(a)` (запись с правами `600`, для refresh-токенов;
`ctx.saveAccount(null)` — удалить файл аккаунта), `ctx.json`, `ctx.flags`,
`ctx.page`, `ctx.limit`, `ctx.prompt()` и `ctx.secret()` (терминальный ввод,
`secret` — без эха; без tty оба бросают `tty`), `ctx.warn()` (строка в stderr).

Флаги своих команд, которые принимают значение, объявляются в `valueFlags`;
контрактные (`--brand`, `--page`, `--limit`, `--qty`, `--ref`) SDK добавляет сам.

### На другом языке

SDK не нужен, нужен исполняемый файл `adoc-<id>` в `PATH`. Требования:

1. Отвечать на `describe --json` объектом `Describe` с `contract: 1` — без
   этого провайдер не попадёт в агрегацию.
2. Реализовать обязательные команды и все команды объявленных capabilities.
3. С `--json` печатать в stdout ровно один JSON-объект описанной здесь формы,
   ошибки — телом `{"error":{"code","message"}}`.
4. Соблюдать exit-коды: `0` — успех, `2` — `ambiguous`, `1` — остальные ошибки.
5. Хранить аккаунт в `$ADOC_CONFIG_DIR/accounts/<id>.json` (или в
   `$XDG_CONFIG_HOME/adoc`, или в `~/.config/adoc`) с правами `600`.
6. Не печатать в stdout ничего лишнего и не ждать stdin нигде, кроме `login`.

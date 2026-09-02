# adoc как агрегатор магазинов запчастей — дизайн

Дата: 2026-09-01. Статус: на утверждении.

## Зачем

Сейчас `adoc` — CLI для одного сайта, autodoc.ru. Нужен инструмент для агента,
который ищет запчасть по артикулу сразу на нескольких сайтах (первый новый —
armtek.ru), показывает цены, сроки, наличие, оценки и отзывы, держит аккаунты
всех сайтов в одном месте и хранит гараж локально, а не на сайтах.

Сайтов может быть любое количество. Добавление нового не должно требовать
правок в агрегаторе: сайт — это отдельная исполняемая программа, которая
выполняет контракт из этого документа.

## Цели

1. `adoc part <артикул>` опрашивает все подключённые сайты и показывает
   единую таблицу предложений: цена, наличие, срок, продавец, оценка.
   Набор сайтов регулируется флагами.
2. `adoc search <текст>` — поиск по названию детали на всех сайтах, единый
   список товаров с артикулами, откуда дальше идёт `part`.
3. `adoc reviews <артикул>` — оценки и отзывы со всех сайтов, где они есть.
4. Менеджер аккаунтов: `login`, `logout`, `accounts`, `whoami` для любого сайта.
5. Гараж живёт в конфиге тулзы, импортируется с сайтов, у которых он есть.
6. Мультикорзина: `adoc basket` показывает корзины всех сайтов вместе,
   предложение из `part` кладётся в корзину своего сайта одной командой.
7. `adoc <сайт> <команда>` работает для любого сайта без правок агрегатора:
   у каждого сайта свой полный CLI со своими командами, агрегатор пробрасывает.
8. Контракт строго регламентирован и версионирован; общение — JSON через
   флаг `--json` у провайдерских CLI, вывод для человека делает агрегатор.

## Не цели

- Оформление заказа и оплата. Корзина наверху есть, заказ — только через
  сайт или провайдерские команды. Избранное — провайдерское.
- Несколько аккаунтов одного сайта. Один аккаунт на провайдера.
- B2B веб-сервисы ws.armtek.ru. Розничному аккаунту они недоступны (401 на
  `getUserVkorgList`), и они не нужны: у сайта armtek.ru есть свой REST.

## Имя

Имя тулзы решается позже. Пока везде `adoc`. Имя должно жить в одном месте:
константа `TOOL` в `src/sdk/config.ts` (префикс провайдеров, имя каталога
конфига, имя переменной окружения) и поле `bin` в `package.json`. Переименование
— один коммит.

## Архитектура

```
adoc                      обёртка: argv, аккаунты, гараж, агрегация, проброс
  ├─ adoc-autodoc         провайдер autodoc.ru (текущий код)
  ├─ adoc-armtek          провайдер armtek.ru (новый)
  └─ adoc-*  в PATH       внешние провайдеры, любой язык
```

Три бинаря в одном репозитории и одном `package.json`:

```json
"bin": { "adoc": "./src/main.ts", "adoc-autodoc": "./src/providers/autodoc/main.ts", "adoc-armtek": "./src/providers/armtek/main.ts" }
```

Структура исходников:

```
src/
  main.ts                 обёртка (агрегатор)
  core/                   внутренности агрегатора
    registry.ts           поиск провайдеров: встроенные + adoc-* в PATH
    invoke.ts             spawn провайдера, таймаут, разбор JSON, маппинг ошибок
    validate.ts           валидаторы ответов провайдеров по контракту
    part.ts               поиск по партномеру: склейка brands, fan-out offers, слияние
    search.ts             поиск по названию: fan-out search, склейка товаров
    reviews.ts            fan-out reviews
    accounts.ts           accounts/<provider>.json: список и удаление; пишет файл сам провайдер
    garage.ts             garage.json
    basket.ts             мультикорзина: fan-out basket, add по номеру из last-part.json
  sdk/                    SDK провайдера, см. раздел «SDK провайдера»
    index.ts              defineProvider, runProvider, ProviderError — публичная поверхность
    contract.ts           типы контракта v1: Product, BrandHit, Offer, Reviews, Car, коды ошибок
    run.ts                argv → диспетчер → JSON или рендер → exit-код
    cli.ts                разбор argv, флаги контракта, hasTTY, readLine/readSecret
    render.ts             текущий render.ts + стандартные таблицы для типов контракта
    account.ts            accountStore(id): чтение/запись accounts/<id>.json, 600
    config.ts             каталог конфига, ADOC_CONFIG_DIR, константа TOOL
    http.ts               fetch с таймаутом, разбор JSON, HttpError → ProviderError("http")
    errors.ts             ProviderError, exitCode, errorBody
    keys.ts               articleKey/brandKey — нормализация артикула и бренда
  providers/
    autodoc/{main,api,auth,brand,commands,map,provider}.ts
    armtek/{main,api,auth,provider}.ts
docs/
  contract.md             контракт провайдера — единственный источник правды
  autodoc-api.md          как есть
  armtek-api.md           карта REST armtek.ru тем же форматом
skills/adoc/SKILL.md      переписать под мультипровайдер
```

### Обнаружение провайдеров

`registry.ts` собирает список:

1. Встроенные — по пути относительно `main.ts`: `providers/*/main.ts`. Запускаются
   через `bun <путь>`, чтобы работать и без глобальной установки.
2. Внешние — исполняемые файлы `adoc-*` в каталогах `PATH`. Имя после дефиса —
   id провайдера. Встроенный с тем же id имеет приоритет.

`adoc providers` печатает id, путь, версию контракта, capabilities и статус
аккаунта. Провайдер, чей `describe` не прошёл валидацию, показывается с ошибкой
и в агрегацию не попадает.

### Вызов провайдера

`invoke.ts`:

- `spawn(bin, [cmd, ...args, "--json"], { env: { ...process.env, ADOC_CONFIG_DIR } })`.
- stdout собирается и парсится как один JSON-объект. Всё до первого `{` и после
  последнего `}` считается мусором и отбрасывается с предупреждением в stderr —
  защита от провайдеров, которые случайно печатают лишнее.
- stderr провайдера пробрасывается в stderr обёртки как есть.
- stdin: наследуется только для `login`. Для остальных команд — закрыт.
- Таймаут 30 с, потом SIGTERM и `{error: {code: "timeout"}}`.
- Exit-код провайдера переносится в результат вызова; агрегатор решает сам,
  что с ним делать.
- Провайдеры вызываются параллельно (`Promise.allSettled`).

## SDK провайдера

Провайдер — это API-обёртка сайта плюс объект, реализующий контракт. Всё
остальное (argv, `--json`, рендер, файл аккаунта, подсказки в tty, exit-коды,
`describe`) делает SDK в `src/sdk/`. Внешние провайдеры на других языках
реализуют `docs/contract.md` сами; SDK — это тот же контракт, выраженный
типами TypeScript, так что встроенный провайдер не может его не выполнить:
пропущенный `offers` — ошибка компиляции.

```ts
// src/providers/armtek/main.ts
import { runProvider } from "../../sdk"
import { armtek } from "./provider"
await runProvider(armtek)

// src/providers/armtek/provider.ts
export const armtek = defineProvider({
  id: "armtek", name: "Armtek", site: "https://armtek.ru",
  capabilities: ["reviews", "garage", "analogs"],

  // контракт — обязательные методы, типы из sdk/contract.ts
  login:   async (ctx) => { /* ctx.prompt, ctx.secret → Account */ },
  whoami:  async (ctx) => { /* ctx.account → Display | null */ },
  search:  async (ctx, text) => ({ items: Product[] }),   // страница и лимит — в ctx
  brands:  async (ctx, article) => ({ items: BrandHit[] }),
  offers:  async (ctx, article, brand, { analogs }) => ({ items: Offer[] }),

  // необязательные, включаются по capabilities (проверяется типами)
  reviews:      async (ctx, article, brand) => Reviews,
  garageExport: async (ctx) => ({ cars: Car[] }),

  // свои команды: adoc armtek stores, adoc armtek vstel …
  commands: {
    stores: { usage: "stores [поиск]", about: "точки выдачи", auth: false,
              run: async (ctx, args) => ({ json: raw, render: () => table(...) }) },
  },
})
```

`ctx` — контекст вызова: `ctx.account` (типизированный аккаунт провайдера,
уже прочитанный из `accounts/<id>.json`), `ctx.saveAccount()` (запись с 600,
для refresh-токенов), `ctx.json` (просили ли JSON), `ctx.flags`, `ctx.page`, `ctx.limit`, `ctx.prompt()`
и `ctx.secret()` (tty-ввод, `secret` без эха), `ctx.warn()` (в stderr).

SDK делает за провайдера:

- Разбор argv по заранее известным командам и ключам контракта (`--json`,
  `--brand`, `--page`, `--limit`, `--analogs`, `--qty`, `--ref`) плюс
  объявленные провайдером флаги своих команд (`valueFlags`).
- `describe` — собирается из объявления: id, name, site, capabilities и список
  команд (контрактные + свои) с `usage`/`about`/`auth`.
- `--json`: сериализует возвращённый объект, гарантирует один объект в stdout.
  Без `--json`: рендерит стандартной таблицей для типа контракта (Product,
  BrandHit, Offer, Reviews, Car) или `render()` своей команды.
- Ошибки: провайдер бросает `ProviderError(code, message)`, SDK превращает в
  `{error}` и exit-код. Порядок разбора: `ProviderError` как есть → `mapError`
  провайдера → `HttpError` из `sdk/http.ts` в `http` → всё прочее в `internal`.
  `ambiguous` — exit 2 с `items`.
- `login` без tty — `{error: {code: "tty"}}` до вызова провайдера.
- Файл аккаунта: чтение до вызова, `ctx.saveAccount()` после; провайдер не
  знает про пути и права.
- Таймаут HTTP через `sdk/http.ts` (провайдер может не пользоваться им и брать
  свой `fetch`).

Агрегатор импортирует из `sdk/contract.ts` только типы и `validate.ts` — сам
он провайдером не является и `runProvider` не зовёт.

## Контракт v1

Полный текст — `docs/contract.md`. Здесь суть.

### Протокол: флаг `--json`

Провайдер — самостоятельный CLI. Агрегатор общается с ним только одним
способом: запускает `<провайдер> <команда> <аргументы> --json` и читает stdout.
С `--json` провайдер печатает в stdout ровно один JSON-объект описанной ниже
формы и больше ничего; подсказки и прогресс идут в stderr. Без `--json`
провайдер печатает что угодно для человека — это его собственный интерфейс,
агрегатор его не читает. Таблицы для общей выдачи рисует агрегатор сам, в
своём формате, из JSON.

Все команды контракта принимают `--json`. Флаги контракта: `--json`,
`--brand <имя>`, `--page <n>`, `--limit <n>`, `--analogs`, `--qty <n>`,
`--ref <json>`. Флаг со значением — `--flag value` или `--flag=value`:
разбор забирает следующий токен как есть.

### Обязательные команды

| команда | ответ |
|---|---|
| `describe` | `{contract: 1, id, name, site, capabilities: string[], commands: Command[]}` |
| `login` | `{account: object, display: Display}` — диалог через tty; в `--json` печатает токены |
| `logout` | `{ok: true, had: boolean}` — SDK даёт его всем провайдерам |
| `whoami` | `{ok: boolean, display?: Display}` |
| `search <текст> [--page --limit]` | `{items: Product[], total?: number, extra?: object}` — поиск по названию |
| `brands <артикул>` | `{items: BrandHit[]}` — поиск по партномеру, шаг 1 |
| `offers <артикул> --brand <имя> [--analogs]` | `{items: Offer[]}` — поиск по партномеру, шаг 2 |

### Необязательные команды и capabilities

| capability | команда | ответ |
|---|---|---|
| `reviews` | `reviews <артикул> --brand <имя> [--page --limit]` | `Reviews` |
| `garage` | `garage export` | `{cars: Car[]}` |
| `analogs` | флаг `--analogs` у `offers` поддержан | — |
| `basket` | `basket` | `Basket` |
| `basket` | `basket add --ref <json> [--qty <n>]` | `Basket` — после добавления |
| `basket` | `basket set <itemId> --qty <n>` | `Basket` |
| `basket` | `basket rm <itemId>` | `Basket` |

Провайдер с `basket` обязан отдавать `ref` в каждом `Offer`: это непрозрачный
объект, который `basket add` принимает обратно как есть. Что внутри — дело
провайдера (у autodoc это идентификаторы прайс-строки и партнёра, у armtek —
`ARTID`, `KEYZAK`, `PARNR` и прочее). Все четыре операции возвращают корзину
целиком после изменения, чтобы агрегатору не нужен был второй вызов.

Любая другая команда — провайдерская. Обёртка пробрасывает её как есть и
печатает stdout без разбора (с `--json` — как есть, без — тоже как есть).

### Типы

```ts
type Command = { name: string; usage: string; about: string; auth: boolean }

type Display = { name: string; email?: string; phone?: string }  // как отдаёт сайт

type Rating = { average: number; count: number }                 // count — число оценок

type Product = {          // результат поиска по названию
  article: string
  brand: string
  name: string
  price?: number          // минимальная цена, если сайт отдаёт её в выдаче
  currency?: "RUB"
  quantity?: number
  rating?: Rating
  images?: string[]
  url?: string
  category?: string
  extra?: Record<string, unknown>
}

type BrandHit = {
  brand: string          // человекочитаемое имя, ключ склейки между провайдерами
  article: string        // как отдал сайт
  name?: string
  rating?: Rating
  images?: string[]
  extra?: Record<string, unknown>  // сырые провайдерские поля (у autodoc — manufacturerId)
}

type Offer = {
  article: string
  brand: string
  name?: string
  price: number
  currency: "RUB"
  quantity?: number
  deliveryDays?: number
  deliveryDate?: string  // YYYY-MM-DD
  seller?: string        // склад, партнёр, точка выдачи — человекочитаемо
  stock?: { code: string; name?: string }  // склад, если сайт различает
  rating?: Rating
  images?: string[]
  url?: string           // страница товара на сайте
  ref?: Record<string, unknown>  // что нужно сайту для basket add; обязателен при capability basket
  analog?: boolean       // true — это аналог, не запрошенный артикул
  analogOf?: { article: string; brand: string }
  extra?: Record<string, unknown>  // сырые провайдерские поля, обёртка не трогает
}

type Reviews = {
  total: number          // число отзывов с текстом
  rating?: Rating & { histogram?: number[] }  // от 5★ к 1★
  summary?: { pros: string[]; cons: string[] }
  items: Review[]
}

type Review = {
  author?: string
  date?: string          // YYYY-MM-DD
  rating?: number        // 1..5
  pros?: string
  cons?: string
  text: string
  purchased?: boolean    // сайт подтверждает покупку
}

type Basket = {
  items: BasketItem[]
  total?: number         // сумма по корзине, если сайт считает
  currency: "RUB"
  url?: string           // страница корзины на сайте
}

type BasketItem = {
  id: string             // идентификатор позиции для set/rm, как отдал сайт
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

type Car = {
  brand: string
  model: string
  modification?: string
  year?: number
  engine?: string
  vin?: string
  odometer?: number
  ref: Record<string, unknown>   // идентификаторы сайта: carId, modificationId и т.п.
}
```

### Ошибки и exit-коды

Ошибка: exit `1`, stdout `{error: {code, message}}`. Коды:

| код | смысл |
|---|---|
| `auth` | нужен вход; обёртка подсказывает `adoc login <provider>` |
| `http` | сайт ответил ошибкой; `message` содержит статус и кусок тела |
| `notfound` | артикул или бренд не найдены |
| `tty` | `login` без терминала |
| `timeout` | превышен собственный таймаут провайдера |
| `bad_args` | неверные аргументы или неизвестная команда |
| `internal` | всё остальное: неожиданное исключение внутри провайдера |

Неоднозначный бренд: exit `2`, `{error: {code: "ambiguous", items: BrandHit[]}}`.
Пустой результат — не ошибка: exit `0`, `{items: []}`.

### Правила для провайдеров

- Артикул на входе принимается в любом виде. Провайдер сам приводит его к
  форме сайта.
- `brand` в ответах — как показывает сайт, без обрезки. Склейку делает обёртка.
- `display` — как отдаёт сайт: полные имя, email и телефон, без маскировки.
  Прячет их тот, кто рисует вывод, а не провайдер.
- Аккаунт: `accounts/<id>.json` в `ADOC_CONFIG_DIR`. Провайдер владеет файлом
  целиком: создаёт его в `login`, читает и обновляет (refresh-токены), права
  600. Обёртка только перечисляет файлы в `accounts` и удаляет при `logout`.
  Содержимое файла — дело провайдера; в ответе `login` поле `account` —
  копия того, что записано, для обёртки оно непрозрачно.
- Пароли на диск не пишутся. Если у сайта нет токенов, провайдер обязан явно
  сказать об этом в `describe.name` или документации.
- `--json` означает: ни строки в stdout кроме JSON. Подсказки и прогресс — в
  stderr.

## Хранилище

Каталог: `$ADOC_CONFIG_DIR`, иначе `$XDG_CONFIG_HOME/adoc`, иначе
`~/.config/adoc`. Обёртка всегда передаёт `ADOC_CONFIG_DIR` детям.

```
accounts/autodoc.json    токены autodoc, 600
accounts/armtek.json     токены armtek, гостевой токен, vstel, 600
garage.json              локальный гараж
last-part.json           последняя выдача `part` с `ref` предложений, для `basket add <n>`
```

`garage.json`:

```json
{
  "mainId": 1,
  "nextId": 2,
  "cars": [
    { "id": 1, "brand": "SKODA", "model": "OCTAVIA III лифтбек (5E3)", "modification": "1.8 TSI",
      "year": 2017, "vin": "…", "engine": "1.8 TSI", "odometer": 0,
      "refs": { "autodoc": { "carId": 0, "modificationId": 58759 } } }
  ]
}
```

`nextId` — счётчик номеров машин, а не максимум по списку: после удаления
последней машины максимум откатился бы назад и новая получила бы номер уже
удалённой. В файле, где счётчика ещё нет, он один раз считается по максимуму.

Миграция: старый `token.json` при первом запуске переносится в
`accounts/autodoc.json`, если того ещё нет. Старый файл удаляется.

## Команды обёртки

| команда | что делает |
|---|---|
| `part <артикул> [бренд]` | поиск по партномеру, главная команда, см. ниже |
| `search <текст>` | поиск по названию детали, см. ниже |
| `reviews <артикул> [бренд]` | оценки и отзывы со всех провайдеров с `reviews` |
| `basket` | мультикорзина: корзины всех провайдеров с `basket`, см. ниже |
| `basket add <n> [--qty <k>]` | положить строку `n` из последнего `part` в корзину её провайдера |
| `basket add <provider> --ref <json> [--qty <k>]` | то же, но с явным `ref` (для агента и скриптов) |
| `basket set <provider> <itemId> --qty <k>` / `basket rm <provider> <itemId>` | изменить / убрать |
| `garage` | список машин, ★ — основная, с подсказкой provider-ссылок |
| `garage import <provider>` | `garage export` у провайдера, слияние по VIN, иначе по марка+модель+год |
| `garage add --brand … --model … [--modification --year --vin --engine --odometer]` | руками |
| `garage main <id>` / `garage rm <id>` | основная / удалить |
| `login <provider>` / `logout <provider>` | делегирует провайдеру / удаляет файл аккаунта |
| `accounts` | таблица: провайдер, статус, display |
| `whoami` | `whoami` у всех провайдеров |
| `providers` | найденные провайдеры, версия контракта, capabilities |
| `<provider> <cmd> …` | проброс, включая `--help` |
| `--help` | справка обёртки + одна строка на провайдера из `describe` |

Флаги: `--json`, `--only a,b`, `--skip a,b`, `--limit <n>`, `--page <n>`,
`--analogs`.

### `part` — поиск по партномеру

1. Ключ артикула: верхний регистр, удалены все символы кроме букв и цифр.
   `n90954802`, `N90954802`, `N 909 548 02` — одно и то же. Латиница и кириллица
   не смешиваются намеренно: сайт сам решает, что считать совпадением, обёртка
   лишь сравнивает то, что он вернул, с тем, что спросили.
2. `brands <артикул>` у всех выбранных провайдеров параллельно. Результаты
   склеиваются по ключу бренда (верхний регистр, обрезка пробелов, схлопывание
   внутренних пробелов и дефисов). Позиции с чужим ключом артикула отбрасываются.
3. Если брендов несколько и аргумент `[бренд]` не дан — таблица брендов с
   колонкой «где» (у каких провайдеров есть), exit `2`. Если дан — берётся
   первый, чей ключ совпадает; иначе exit `2` с той же таблицей.
4. `offers <артикул> --brand <имя>` у тех же провайдеров параллельно. Каждому
   провайдеру передаётся имя бренда в его собственном написании (из его
   `brands`), не нормализованное.
5. Точные предложения (ключ артикула совпал) — основная таблица, сортировка по
   цене. Аналоги (`analog: true` или ключ не совпал) — только с `--analogs`,
   отдельным блоком ниже.
6. Таблица: `ПРОВАЙДЕР  БРЕНД  НАЗВАНИЕ  ЦЕНА  НАЛИЧИЕ  СРОК  ПРОДАВЕЦ  РЕЙТИНГ`.
   `--limit` режет каждую из таблиц.
7. `--json`: `{article, brand, brands: BrandHit[], offers: Offer[], analogs: Offer[], errors: ProviderError[]}`,
   где у каждого Offer добавлено поле `provider`.

### `search` — поиск по названию

1. `search <текст>` у всех выбранных провайдеров параллельно, с `--page` и
   `--limit` как есть.
2. Товары склеиваются по паре ключей (артикул, бренд) — нормализация та же,
   что в `part`. Одинаковый товар с двух сайтов — одна строка с колонкой «где»
   и минимальной ценой среди провайдеров.
3. Порядок: сначала товары, найденные у большего числа провайдеров, внутри —
   по цене. `--limit` режет итоговый список.
4. Таблица: `АРТИКУЛ  БРЕНД  НАЗВАНИЕ  ОТ  НАЛИЧИЕ  РЕЙТИНГ  ГДЕ`, подсказка
   внизу: `adoc part <артикул> <бренд>` для предложений.
5. `--json`: `{query, items: (Product & {providers: string[], prices: Record<string, number>})[], errors}`.

### Частичный отказ

Провайдер, вернувший ошибку, попадает в stderr одной жёлтой строкой
(`armtek: нужен вход — adoc login armtek`), остальные результаты печатаются.
В `--json` — `errors: [{provider, code, message}]`. Если ошибку вернули все —
exit `1`. Exit `2` только за неоднозначный бренд.

### `basket` — мультикорзина

1. `adoc basket` — `basket` у всех провайдеров с capability `basket` параллельно.
   Вывод блоками по провайдерам: таблица `#  ID  АРТИКУЛ  БРЕНД  НАЗВАНИЕ
   ЦЕНА  КОЛ  СУММА  СРОК`, итог по провайдеру, общий итог по всем внизу. Провайдер
   без входа — жёлтая строка `armtek: нужен вход`, остальное печатается.
   `--json`: `{providers: {<id>: Basket}, total, errors}`.
2. `adoc part` нумерует строки предложений (`#`) и сохраняет последнюю выдачу
   в `$ADOC_CONFIG_DIR/last-part.json`: артикул, бренд, время и предложения с
   `provider` и `ref`. `adoc basket add <n> [--qty <k>]` берёт строку `n`
   оттуда и зовёт `basket add --ref <json> --qty <k>` у её провайдера. Файл
   старше суток — ошибка «повтори `adoc part`», чтобы не класть протухшую цену.
3. `basket add <provider> --ref <json>` — тот же путь без кэша: `ref` берётся
   из `--json`-выдачи `part`.
4. `basket set` и `basket rm` — проброс провайдеру с его `itemId`: колонка `#`
   в выводе корзины — порядковый номер, колонка `ID` — сам `itemId`. Двумя
   колонками, а не одной: у autodoc `itemId` длинный и склеенный, в одной
   ячейке с номером он нечитаем, а копировать его приходится целиком.
5. После любого изменения печатается корзина того провайдера, которого тронули.

### `reviews`

Те же шаги 1–3 из `part` для бренда, затем `reviews` у провайдеров с capability
`reviews`. Вывод блоками по провайдерам: заголовок с рейтингом и числом,
гистограмма, выжимка, лента. `--json`:
`{article, brand, providers: {<id>: Reviews}, errors}`.

## Провайдер autodoc

Текущий код переезжает в `src/providers/autodoc/`: `api.ts` и `auth.ts` —
как есть, командная часть `main.ts` превращается в `provider.ts` с
`defineProvider`. Нынешние команды (`goods`, `info`, `basket`, `favorites`,
`orders`, `profile`, `garage parts`, `garage main`, `get`, `post`,
`login --paste`) становятся `commands` провайдера. Добавляется:

- `describe`: capabilities `reviews`, `garage`, `analogs`, `basket`.
- `search <текст>`: два шага сайта в одном вызове — подсказка
  `catalog-universal-categories/search`, из неё категории (не производители),
  затем `find-goods` по первой категории с `PageNumber`/`--limit`. Если
  категорий несколько, берётся первая, остальные — в `extra.categories`, чтобы
  человек мог уточнить через `adoc autodoc goods <categoryId>`. Product из
  `CatalogGood`: артикул, производитель, название, цена, количество, рейтинг.
- `brands`: поверх `price-service/search/manufacturers`; `rating` через
  `goods/info` на каждого производителя (как сейчас в `part`).
- `offers`: `price-list/originals` (нужен вход). Без входа — `{error: {code: "auth"}}`.
  `--analogs` — плюс `price-list/analogs`, помечено `analog: true`.
  Если входа нет, но `--json` не просили — как сейчас, подсказка про `login`.
- `reviews`: поверх `feedback/messages` и `goods/info`.
- `garage export`: `garage/cars` + `top-car`, `ref = {carId, modificationId}`.
- `basket`: поверх `basket-service/basket/items` (GET — список, POST — добавить,
  PUT — изменить, DELETE с телом — убрать). Тела POST/PUT в карте не
  восстановлены — снять с фронта при реализации. `Offer.ref` для autodoc —
  поля строки `price-list/originals`, которые фронт шлёт в POST `basket/items`.
- `login` печатает `{account: Tokens, display}` при `--json`; `--paste` остаётся.
- Файл аккаунта — `accounts/autodoc.json` вместо `token.json`.

Все команды принимают `--brand <имя>` вместо позиционного `brandId`: провайдер
находит производителя по имени через `search/manufacturers`. У контрактных
`offers` и `reviews` это единственный способ задать бренд; позиционный
числовой `brandId` остаётся только у собственных команд (`info`, `prices`,
`analogs`) для совместимости.

## Провайдер armtek

Сайт armtek.ru — Angular SPA, свой REST по адресу `https://armtek.ru/rest/ru/`.
В бандле 294 вызова по 37 микросервисам; полная карта, снятые ответы и рецепт
снятия — `docs/armtek-api.md`. Ниже — только то, что определяет форму
провайдера; подробности каждой ручки не дублируются.

Проверено против прода 2026-09-02 (реализовано в `src/providers/armtek/`):

- Ответ всегда `{data, arr_messages: [{type, text, …}], execution_time}`;
  ошибка — HTTP-статус плюс `arr_messages[].type === "E"`. Заголовки фронта
  `X-AUTH-SYSTEM`/`X-AUTH-TOKEN` обязательны везде, `X-CA-VKORG` — тоже:
  без него корзина отвечает 200 и пустотой вместо ошибки.
- Токены: `POST auth-microservice/v1/guest` — гостевой JWT (с ним работают
  поиск, отзывы и список точек выдачи), `POST auth-microservice/v1/auth/login`
  с `{login, password}` и `POST auth-microservice/v1/auth/refresh` с
  refresh-токеном в `Authorization`. Refresh ротируется — новый обязателен к
  сохранению.
- Поиск — `POST search-microservice/v1/search`. `queryType: 1` — точные
  совпадения **вместе с аналогами**, `queryType: 2` — только точные.
  `typeView` задаём всегда (`list` или `card`): без него сервер сам выбирает
  форму ответа, а форма `card` приходит без `SUGGESTIONS`. `userInfo`
  (`VKORG`, `VSTELS_LIST`) обязателен: от точки выдачи зависят цена, срок и
  наличие.
- Цены, наличие и сроки лежат не в строке артикула, а в её `SUGGESTIONS[]` —
  одна строка выдачи разворачивается в столько предложений, сколько складов.
  В строке: `PIN`, `BRAND`, `NAME`, `RATING`, `REVIEW_COUNT`, `PHOTO[]`,
  `ARTICLE_ALIAS`, `ARTID`. В предложении: `PRICES1` (цена строкой),
  `RVALUE` — остаток **строкой**, на больших складах это `">20"` (нижняя
  граница, а не точное число), `DLVDT`/`ORDDT` — даты SAP `YYYYMMDD[HHMMSS]`
  с пустым значением `"00000000"`, `KEYZAK` — код склада, `MINBM` —
  минимальная партия. Пагинация — `pagination.{currentPage, perPage,
  totalCount, pageCount}`, страница 36 строк.
- Профиль — `GET client-microservice/v1/client/individual/get-client`
  (не `auth-microservice`): оттуда имя, почта, телефон, `VSTEL_DATA` и коды
  клиента.
- Отзывы есть отдельным сервисом: лента —
  `GET review-microservice/v2/review/get-list-by-artid?artId=…`, оценки и
  гистограмма — `GET review-microservice/v2/review/get-rating-by-artids`.
  Ленту сайт отдаёт с ФИО и телефоном автора; наружу уходит только «Имя Ф.».
- Гараж — `GET task-selection-microservice/v1/garage/get-transport-list-by-filter?client_id=…`,
  `client_id` — из клеймов токена.
- Корзина — `cart-microservice/v1/base`: GET (со списком точек в `vstels[]`) —
  состояние, POST — добавить, PUT — изменить количество, DELETE — убрать.
  POST по существующей позиции сайт отбивает, поэтому смена количества —
  только PUT.

Провайдер:

- `describe`: capabilities `reviews`, `garage`, `analogs`, `basket`.
- `search <текст>`: `queryType: 1`, `typeView: "list"`, страница из `--page`.
- `brands`: `queryType: 2` постранично до потолка в 5 страниц, группировка по
  `BRAND` среди строк с совпавшим ключом артикула. Упёрлись в потолок — в
  stderr предупреждение: список брендов неполный.
- `offers`: бренд выбирается среди точных совпадений (`queryType: 2`), без
  `--analogs` разворачиваются `SUGGESTIONS` только его строки. С `--analogs`
  берётся `queryType: 1`, и, поскольку `--page` контракт для `offers` не
  предусматривает, о неполноте выдачи провайдер говорит в stderr.
- `Offer.ref` — всё, что нужно телу POST корзины, чтобы не спрашивать сайт
  заново: `artid`, `keyzak`, `parnr`, `numZak`, `prices`, `pricem`, `waers`,
  `charg`, `vstels`, `zzsign`, `minbm`, `article`, `brand`.
- `Offer.seller` — «armtek»: продавец один, а `KEYZAK` это код склада и
  живёт в `extra.keyzak`. Строка без цены предложением не считается.
- Файл аккаунта `accounts/armtek.json`:
  `{access, refresh, expires, guest: {token, expires}, vkorg, vstel, clientId,
  category, segment}`. Персональных данных в нём нет — профиль каждый раз
  спрашивается у сайта.
- `login`: телефон `7XXXXXXXXXX` или e-mail с паролем в терминале, либо
  `ARMTEK_PHONE` и `ARMTEK_PASSWORD` из окружения, когда заданы обе. Из argv
  пароль не принимается.
- Свои команды: `info <артикул> --brand <имя>` (карточка формой `card`),
  `vstel [поиск]` (точки выдачи, текущая помечена), `raw <METHOD> <путь>`
  (любой вызов `rest/ru` с токеном аккаунта — умеет и писать, поэтому
  объявлена `auth: true`).

## Тесты

`bun test`, без сети:

- `core/part.test.ts`: ключи артикула и бренда, склейка `brands` с разных
  провайдеров, разделение точных и аналогов, сортировка, `errors`.
- `core/search.test.ts`: склейка товаров по (артикул, бренд), порядок,
  минимальная цена по провайдерам.
- `core/invoke.test.ts`: разбор stdout с мусором, таймаут, exit-коды —
  на фиктивном провайдере-скрипте в `test/fixtures/fake-provider.ts`.
- `sdk/run.test.ts`: минимальный провайдер через `defineProvider` — `describe`
  собирается из объявления, `--json` печатает один объект, `ProviderError`
  → exit-код и `{error}`, `login` без tty → `tty`, `ambiguous` → exit 2,
  аккаунт читается и пишется через `ctx`.
- `core/garage.test.ts`: импорт со слиянием по VIN, `main`, `rm`.
- `core/basket.test.ts`: слияние корзин и итогов, `basket add <n>` из
  `last-part.json`, протухший кэш, провайдер без `basket` в списке.
- Провайдеры: парсеры ответов на записанных фикстурах реальных ответов
  (`test/fixtures/autodoc/*.json`, `test/fixtures/armtek/*.json`), без
  секретов.
- Контрактный тест: для каждого встроенного провайдера запуск `describe`
  и валидация формы; `brands`/`offers` на фикстурах через переменную
  `ADOC_FIXTURES=<dir>`, которую провайдеры уважают вместо сети.

Живые вызовы — ручная проверка по чек-листу в плане реализации.

## Документация

- `README.md` — переписать: что это, установка, команды обёртки, флаги, как
  подключён каждый провайдер, как добавить свой (ссылка на `docs/contract.md`).
- `docs/contract.md` — контракт целиком, с примерами ответов.
- `docs/armtek-api.md` — карта REST armtek.ru, формат как у `autodoc-api.md`.
- `skills/adoc/SKILL.md` — общая часть (part, search, reviews, garage, аккаунты,
  exit-коды, что нельзя) плюс по разделу на провайдера с их ловушками.

## Открытые вопросы

- Имя тулзы (решается позже, см. «Имя»).
- Эндпоинт ленты отзывов armtek — искать при реализации.
- Тела запросов корзины у обоих сайтов — снять с фронта при реализации; от
  них зависит состав `Offer.ref`.
- Формат URL карточки товара armtek — проверить при реализации.

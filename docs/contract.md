## autodoc

Свои команды сверх контракта:

| команда | что делает | вход |
|---|---|---|
| `goods <categoryId> [--page <n>] [--sort <id>] [--limit <n>]` | товары внутри категории (id даёт `search`) | |
| `prices <артикул> [brandId \| --brand <имя>]` | предложения продавцов как их отдаёт сайт (`originals`) | да |
| `favorites [listId]` | избранное; без аргумента — списки | да |
| `profile` | сводка по аккаунту | да |
| `garage [parts <carId> \| main <carId>]` | гараж сайта: список, подборка под машину, основная | да |
| `get <путь> [k=v ...] [--auth]` | произвольный GET к `web.autodoc.ru` | |
| `post <путь> [k=v ...] [--auth]` | произвольный POST к `web.autodoc.ru` | |

```sh
$ adoc autodoc goods 408
$ adoc autodoc prices n90954802 --brand VAG
```

`info`, `analogs` и `orders` — команды контракта, а не собственные: их у всех
сайтов зовут одинаково, и у обёртки они есть своими командами
(`adoc info`, `adoc analogs`, `adoc orders`).

Есть вход без пароля: в консоли браузера на сайте с открытой сессией —
`copy(JSON.stringify(sessionStorage))`, вставка — в `adoc autodoc login
--paste`. Старый `token.json` от версии 1 переносится в
`accounts/autodoc.json` автоматически при первом запуске.

`brandId` у собственных команд необязателен: если производитель один, он
подставляется сам. Контрактные `offers` и `reviews` берут бренд только флагом
`--brand`.

## armtek

| команда | что делает | вход |
|---|---|---|
| `vstel [поиск]` | точки выдачи; текущая помечена ★ | |
| `raw <METHOD> <путь> [k=v ...] [--body <json>]` | произвольный вызов `rest/ru`: идёт с токеном аккаунта и любым методом, то есть умеет и писать | да |

Точка выдачи (`vstel`) — не украшение: от неё зависят цена, срок и наличие в
выдаче поиска. Без входа берётся московская по умолчанию, после `login` —
точка аккаунта.

```sh
$ adoc login armtek       # телефон 7XXXXXXXXXX или e-mail и пароль, ввод с терминала
$ ARMTEK_PHONE=7… ARMTEK_PASSWORD=… adoc armtek login   # без терминала
$ adoc armtek vstel москва
```

`ARMTEK_PHONE` и `ARMTEK_PASSWORD` — необязательный путь для запуска без
терминала: заданы обе — `login` берёт учётку из них, нет — спрашивает
человека. Обычному входу они не нужны.

В `~/.config/adoc/accounts/armtek.json` (права `600`) лежат токены, сбытовая
организация, точка выдачи и коды клиента — персональных данных там нет,
профиль каждый раз спрашивается у сайта.

## Свой сайт

Провайдер — это исполняемый файл `adoc-<id>` в `PATH` на любом языке. От него
требуется отвечать на `describe`, `login`, `logout`, `whoami`, `search`,
`brands`, `offers`, `info` и `analogs` в форме [контракта](docs/contract.md),
печатать с `--json`
ровно один JSON-объект в stdout и хранить свой аккаунт в
`$ADOC_CONFIG_DIR/accounts/<id>.json`. Обёртка подхватит его сама, без единой
правки в своём коде: `adoc providers` покажет его в списке, `adoc part` начнёт
его спрашивать. На TypeScript всё, кроме самого сайта, делает
[SDK](src/sdk/index.ts): `defineProvider` + `runProvider`.

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
- `ADOC_NO_WARN` — тишина в stderr: `ctx.warn` не печатает ничего. Ошибок,
  выдачи и exit-кода это не касается. Переменная наследуется детьми как есть,
  и провайдеру на SDK делать для неё ничего не надо: гасит сам `ctx.warn`. Он
  же не повторяет одну и ту же строку дважды за запуск.

### Флаги контракта

| флаг | значение | где |
|---|---|---|
| `--json` | нет (переключатель) | все команды |
| `--brand <имя>` | да | `offers`, `info`, `analogs`, `reviews` |
| `--page <n>` | да | `search`, `reviews`; по умолчанию `1` |
| `--limit <n>` | да | `search`, `reviews`; по умолчанию `30` |
| `--analogs` | нет (переключатель) | `offers`, при capability `analogs` |
| `--car <json>` | да | `search` |
| `--qty <n>` | да | `basket add`, `basket set` |
| `--ref <json>` | да | `basket add` |

`--car` — непрозрачный `Car.ref` из `garage export` **этого же провайдера**:
провайдер сам решает, что в нём лежит и как искать под машину. Провайдер,
который так не умеет или которому не хватает полей в `ref`, обязан сказать это
в stderr и ответить обычной выдачей — это не ошибка. Агрегатор передаёт каждому
провайдеру его собственный ref; машине без ref для этого провайдера он ищет без
машины.

Флаг со значением пишется **`--flag value` или `--flag=value`**. Значение
обязательно: если следующий токен начинается с `--` или его нет вовсе, это
`bad_args: --<флаг>: нужно значение`. Поэтому `search болт --page --json` не
съедает `--json`, а честно падает — и ответ приходит объектом в stdout,
потому что `--json` в строке вызова виден.

Флаг-переключатель (`--json`, `--analogs`, `--help`) значения не берёт;
`--flag=true` — то же, что просто `--flag`, `--flag=false` — то же, что флага
нет, а любое другое `=значение` на переключателе — `bad_args`.

`--page` и `--limit` разбираются до вызова команды: целое число не меньше
единицы, иначе `bad_args` на любой команде.

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
| `search <текст> [--car <json>] [--page <n>] [--limit <n>]` | `{items, total?, extra?}` | `SearchResult` |
| `brands <артикул>` | `{items}` | `BrandsResult` |
| `offers <артикул> --brand <имя> [--analogs]` | `{items}` | `OffersResult` |
| `info <артикул> --brand <имя>` | `{info, offers?}` | `InfoResult` |
| `fits <артикул> --brand <имя> --car <json>` | `{fits, reason?, url?}` | `FitsResult` (capability `fits`) |
| `crosses <артикул> --brand <имя>` | `{items}` | `CrossesResult` (capability `crosses`) |
| `analogs <артикул> --brand <имя>` | `{items}` | `OffersResult` |

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

`info` — карточка детали: то, что сайт показывает до перехода к предложениям
(оценки, цена «от», минимальный срок, склады, характеристики). Все поля кроме
`article`, `brand` и `name` необязательны: провайдер отдаёт то, что у сайта
есть, и не выдумывает остального.

Вместе с карточкой возвращаются и `offers` — те же строки, что отдал бы
`offers` без аналогов, отсортированные по цене: одна цена «от» на вопрос
«сколько стоит» не отвечает. Поле необязательное, и данные для него лучше
брать из того же места, откуда их берёт команда `offers`, — второе правило
«что считать предложением» провайдеру не нужно.

`fits` — применимость к машине: `--car` тот же ref из `garage export`, что и у
`search`. Три состояния, и третье обязательно: `true`, `false` и `null` — «сайт
не знает». Молчаливое `false` там, где данных нет, дороже честного незнания: по
нему деталь не купят. `reason` — короткая причина для человека, `url` —
страница, где применимость видно глазами. Команда необязательная: объявляется
capability `fits`, и без неё агрегатор сайт не спрашивает.

Правила ответа общие для всех сайтов и живут в SDK (`fitsVerdict`): подбор под
машину смотрится **целиком**, а не первой страницей; `false` выдаётся только
тогда, когда подбор похож на каталог (позиций не меньше `THIN_CATEGORY` = 50),
бренд в нём заведён, а номера в нём нет. Подбор из двух десятков позиций, бренд,
которого в подборе нет вовсе, и упёршийся в потолок обход — это `null`: «не
знаю» дешевле выдуманного «не подходит», по которому деталь не купят.

`crosses` — справочник номеров: чем ещё называется тот же узел. Считается для
**пары «артикул + бренд»**, а не для номера: у сайта с общей базой один номер
носят товары разных производителей (у armtek под `900355` лежат и пыльник
SACHS, и моторное масло SINTEC), и замены у них разные. От `analogs`
отличается тем, что это не выдача: цены и наличия здесь нет, а есть номер,
бренд и `kind` — `oe` (оригинальный номер), `aftermarket` (неоригинальная
замена), `part-of` (входит в состав узла). Список видов открыт: сайт со своим
названием группы кладёт его как есть, обёртка покажет его словом. Исходный
артикул в список не попадает — он не ссылка на себя.

`analogs` — **только аналоги**, без точных совпадений: каждая строка идёт с
`analog: true`. Провайдер может собрать её из своего `offers --analogs`,
отфильтровав точные строки. Capability `analogs` при этом остаётся флагом
«умеет аналоги»: команда обязательна для всех, и провайдер, который аналогов не
знает, отвечает пустым списком и пишет об этом в stderr.

`OffersResult.total` — сколько предложений насчитал **сайт**, если он это
говорит. Строк в `items` бывает меньше: сайт отдаёт выдачу страницами, а
`offers`/`analogs` страниц не принимают. Поле необязательное; нет его — считать
итогом длину `items`.

**Ссылки — часть ответа, а не украшение.** Рендер SDK вшивает адрес прямо в
текст строки терминальной ссылкой (OSC 8) там, где терминал их понимает, а
иначе печатает списком под таблицей (`#  адрес`, номер тот же, что в колонке
«#»); адрес всей страницы — в заголовке блока. В строке таблицы адресу на
сотню символов места нет ни в одном из режимов.
Провайдер обязан заполнять `url` везде, где сайт даёт адрес: `Product.url` и `BrandHit.url` — карточка детали,
`Offer.url` — страница предложения (или та же карточка, если отдельной нет),
`Reviews.url` — страница отзывов, `BasketItem.url` — карточка позиции корзины,
`Basket.url` — сама корзина, `Order.url` — заказ или список заказов. Смысл
команды — открыть сайт на нужной странице, а не повторять поиск руками.

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
| `orders` | `orders` | `{items}` (`OrdersResult`) |

`orders` — заказы на сайте: один `Order` на заказ, позиции — в `items`. Сайт,
у которого нет страницы отдельного заказа, кладёт в `Order.url` адрес списка
заказов. Если у позиций одного заказа разные статусы (одна готова к выдаче,
другая ещё едет), `Order.status` — статус самой отставшей, а полный разбор
провайдер кладёт в `extra`.

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
 "capabilities":["reviews","garage","analogs","basket","orders"],
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

export type Capability = "reviews" | "garage" | "analogs" | "basket" | "orders"

export type Rating = { average: number; count: number }

/** Поля как их отдаёт сайт: ни провайдер, ни рендер их не маскируют. */
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
	url?: string // карточка этого артикула у этого бренда на сайте
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
	url?: string // сам отзыв, если сайт его адресует
}

export type Reviews = {
	total: number
	rating?: Rating & { histogram?: number[] } // от 5★ к 1★
	summary?: { pros: string[]; cons: string[] }
	items: Review[]
	url?: string // страница отзывов на сайте
}

/** Карточка товара: то, что сайт показывает до перехода к предложениям. */
export type Info = {
	article: string
	brand: string
	name: string
	url?: string // карточка на сайте
	rating?: Rating & { histogram?: number[] } // от 5★ к 1★
	images?: string[]
	price?: number // «от», если сайт её даёт
	currency?: "RUB"
	deliveryDays?: number // минимальный срок, если сайт его даёт
	/** Склады: `name` — только если у сайта оно есть, иначе виден код. */
	stock?: { code: string; name?: string; quantity?: number; deliveryDays?: number }[]
	description?: string
	extra?: Record<string, unknown>
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
	url?: string // карточка товара этой позиции
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

export type OrderItem = {
	article: string
	brand: string
	name: string
	qty: number
	price: number
	sum?: number
	url?: string
}

export type Order = {
	id: string
	date: string // ISO
	status: string
	total: number
	currency: string
	url?: string
	items?: OrderItem[]
	extra?: Record<string, unknown>
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
/** `total` — сколько предложений насчитал сайт, если он это говорит: строк в
 *  `items` может быть меньше (страница, лимит). */
export type OffersResult = { items: Offer[]; total?: number }
export type CarsResult = { cars: Car[] }
export type InfoResult = { info: Info; offers?: Offer[] }
export type FitsResult = { fits: boolean | null; reason?: string; url?: string }
export type CrossItem = { article: string; brand: string; kind: "oe" | "aftermarket" | "part-of" | string; name?: string; url?: string; extra?: object }
export type CrossesResult = { items: CrossItem[] }
export type OrdersResult = { items: Order[] }
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

`ambiguous` — единственный код с exit `2`: это «нужен бренд», а не «сломалось».
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
- **`Offer.seller` — человекочитаемое название продавца или склада**, то, что
  сайт показывает человеку; коды складов и партнёров живут только в `extra`
  (и в `stock.code`, если у кода есть своё название).
- **`Review.author` — так, как сайт показывает автора публично**, и никогда не
  телефон и не email; маскировать до «Имя Ф.» провайдер вправе, если сайт
  отдаёт больше, чем показывает.
- **`Basket.total` — сумма, которую называет сам сайт**, если он её отдаёт;
  иначе это сумма позиций, и тогда она не обязана совпадать с суммой в
  оформлении заказа (доставка, скидки, округление — не наше дело).
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
{"items":[{"brand":"VAG","article":"N90954802","name":"Болт","rating":{"average":4.9107,"count":56},"images":["https://images.autodoc.ru/goods/657/N90954802/med.webp"],"url":"https://www.autodoc.ru/man/657/part/n90954802","extra":{"manufacturerId":657}}]}
```

Карточка детали:

```console
$ adoc-autodoc info 0986452041 --brand bosch --json
{"info":{"article":"0986452041","brand":"BOSCH","name":"Фильтр масляный","url":"https://www.autodoc.ru/man/30/part/0986452041","rating":{"average":3.5714,"count":7,"histogram":[4,0,1,0,2]},"price":596,"currency":"RUB","deliveryDays":0,"stock":[{"code":"autodoc","name":"на складе","quantity":99}],"description":"Высота: 87 мм; …"}}
```

Поиск с учётом машины — `ref` берётся из `garage export` того же провайдера:

```console
$ adoc-autodoc garage export --json | jq -c .cars[0].ref
{"carId":19119290,"modificationId":58759,"modelId":11195,"brandName":"SKODA","main":true}
$ adoc-autodoc search "фильтр масляный" --car '{"carId":19119290,"modificationId":58759,"modelId":11195,"brandName":"SKODA"}' --json | jq .total
36
```

Предложения без входа — ошибка `auth`, exit `1`:

```console
$ adoc-autodoc offers n90954802 --brand VAG --json
{"error":{"code":"auth","message":"/api/price-service/price-list/originals: нужен вход — `adoc login autodoc`"}}
$ echo $?
1
```

Бренд не определён — `ambiguous`, exit `2`, варианты в `items`:

```console
$ adoc-autodoc offers 0986452041 --brand NOSUCH --json
{"error":{"code":"ambiguous","message":"бренда «NOSUCH» у артикула нет — выбрать из списка","items":[{"brand":"BOSCH","article":"0986452041","name":"Фильтр масляный","extra":{"manufacturerId":30}},{"brand":"TOYOTA","article":"0986452041","name":"","extra":{"manufacturerId":579}}]}}
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

Дальше — `whoami`, `search`, `brands`, `offers`, `info`, `analogs` и, по
capabilities, `reviews`, `garageExport`, `orders`, `basket`; свои команды — в
`commands`. Полный рабочий пример:
`test/fixtures/fake-provider.ts` (провайдер без сети, на нём гоняются тесты
SDK). Публичная поверхность SDK — `src/sdk/index.ts`:

- `defineProvider`, `runProvider` — описание и запуск;
- `Ctx`, `ProviderSpec`, `BasketOps`, `ProviderCommand`, `CommandResult` — типы
  объявления: контекст вызова, готовое описание провайдера, четыре операции
  корзины, своя команда и её ответ (`{json, render?}`);
- `ProviderError`, `ErrorMapper` — ошибки контракта;
- `HttpError`, `fetchJson` — fetch с таймаутом (пользоваться необязательно);
- `browserHeaders(origin[, fetchSite])` — заголовки «как из вкладки браузера»
  (`User-Agent`, `Accept-Language`, `Origin`, `Referer`, `Sec-Fetch-*`): сайт за
  защитой отвечает голому запросу капчей охотнее, чем такому же из браузера;
- `articleKey`, `brandKey` — нормализация для склейки;
- `accountStore`, `configDir`, `CONFIG_DIR_ENV`, `TOOL` — файл аккаунта;
- `render` — таблицы и цвета для вывода человеку (`renderProducts`,
  `renderOffers`, `renderInfo`, `renderReviews`, `renderBasket`, `renderCars`,
  `renderOrders`, а из мелочей — `table`, `fields`, `link`, `urlList`, `money`,
  `days`); `linksMode` и `hyperlink` — режим ссылок (`ADOC_LINKS`:
  `osc8` — адрес терминальной ссылкой в тексте, `list` — списком под таблицей,
  `off` — без адресов) и сама терминальная ссылка OSC 8, если провайдер рисует
  свою таблицу сам; `linksHint(текст)` — строка «ссылки — Cmd+клик …» под
  готовый вывод, пустая, когда вшитых ссылок в нём нет (её печатает `runProvider`
  сам, вручную она нужна только своему рендеру);
- все типы из `contract.ts`.

Контекст вызова `ctx`: `ctx.account` (уже прочитанный аккаунт или `null`),
`ctx.saveAccount(a)` (запись с правами `600`, для refresh-токенов;
`ctx.saveAccount(null)` — удалить файл аккаунта), `ctx.json`, `ctx.flags`,
`ctx.page`, `ctx.limit`, `ctx.prompt()` и `ctx.secret()` (терминальный ввод,
`secret` — без эха; без tty оба бросают `tty`), `ctx.warn()` (строка в stderr).

Флаги своих команд, которые принимают значение, объявляются в `valueFlags`;
контрактные (`--brand`, `--page`, `--limit`, `--qty`, `--ref`, `--car`) SDK
добавляет сам.

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

# adoc

Неофициальный CLI для сайтов автозапчастей: артикул, цена, наличие, срок,
отзывы, аналоги, свой гараж, корзина и заказы. Первый и пока единственный
сайт — [autodoc.ru](https://www.autodoc.ru).

```console
$ adoc-autodoc brands n90954802
БРЕНД  АРТИКУЛ    НАЗВАНИЕ  РЕЙТИНГ
VAG    N90954802  Болт      4.9★ (56)
```

Autodoc не документирует свой API, а `adoc` — неофициальный клиент. Вся
полученная информация может быть неточной, неполной и устаревшей —
[docs/autodoc-api.md](docs/autodoc-api.md).

## Где это сейчас

Инструмент переехал на архитектуру «агрегатор + провайдеры»: каждый сайт — это
отдельный CLI `adoc-<id>`, который выполняет
[контракт провайдера](docs/contract.md), а поверх них будет обёртка `adoc`,
опрашивающая все сайты сразу.

Что уже есть и чего ещё нет:

- **`adoc-autodoc`** — провайдер autodoc.ru, полный CLI, работает.
- **`adoc`** — сейчас это ровно то же самое: тот же бинарь, тот же набор команд.
- **Агрегатор** (`adoc part`, `adoc search`, `adoc basket` сразу по нескольким
  сайтам) — следующий шаг.
- **`adoc-armtek`** — провайдер armtek.ru, после агрегатора.

Имена команд провайдера — контрактные, поэтому старые изменились:

| было | стало |
|---|---|
| `adoc part <артикул>` | `adoc-autodoc brands <артикул>` |
| `adoc prices <артикул> [brandId]` | `adoc-autodoc offers <артикул> --brand <имя>` |
| `adoc analogs <артикул> [brandId]` | `adoc-autodoc offers <артикул> --brand <имя> --analogs` |
| `adoc reviews <артикул> [brandId]` | `adoc-autodoc reviews <артикул> --brand <имя>` |

Старые команды (`goods`, `info`, `prices`, `analogs`, `favorites`, `orders`,
`profile`, `garage`, `get`, `post`) остались как собственные команды провайдера
— они сырее контрактных и отдают ответы сайта как есть.

## Установка

```sh
$ bun install -g github:pashokitsme/adoc
$ gh skill install pashokitsme/adoc adoc
```

## Использование

Контрактные команды — одинаковы у любого провайдера:

| команда | что делает | вход |
|---|---|---|
| `describe` | что умеет провайдер | |
| `login` | войти (диалог в терминале) | |
| `logout` | забыть аккаунт | |
| `whoami` | кто авторизован | |
| `search <текст> [--page <n>] [--limit <n>]` | поиск по названию | |
| `brands <артикул>` | кто выпускает артикул | |
| `offers <артикул> --brand <имя> [--analogs]` | предложения: цена, наличие, срок | да |
| `reviews <артикул> --brand <имя> [--page <n>] [--limit <n>]` | оценки и отзывы | |
| `garage export` | машины из гаража сайта | да |
| `basket` | корзина | да |
| `basket add --ref <json> [--qty <n>]` | положить предложение (`ref` из `offers`) | да |
| `basket set <itemId> --qty <n>` | изменить количество | да |
| `basket rm <itemId>` | убрать позицию | да |

Свои команды autodoc:

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

| флаг | что делает |
|---|---|
| `--json` | один JSON-объект в stdout вместо таблиц |
| `--brand <имя>` | производитель для `offers` и `reviews` |
| `--limit <n>` | сколько строк показывать, по умолчанию 10 |
| `--page <n>` | страница выдачи |
| `--analogs` | добавить аналоги в `offers` |
| `--qty <n>`, `--ref <json>` | количество и предложение для `basket` |
| `--sort <id>` | порядок сортировки в `goods`; доступные id печатает сама команда |
| `--auth` | слать токен в `get` и `post` |

Флаг со значением пишется `--flag value` или `--flag=value`: он забирает
следующий токен целиком, поэтому `--page --json` съест `--json` как номер
страницы. Ставь переключатели раньше или пиши `--page=2`.

Актуальный список команд всегда печатает сам бинарь: `adoc-autodoc --help`,
машине — `adoc-autodoc describe --json`.

`brandId` у собственных команд необязателен: если производитель один, он
подставляется сам. Контрактные `offers` и `reviews` берут бренд только флагом
`--brand`.

## Протокол `--json`

С `--json` в stdout — ровно один JSON-объект и ничего больше; подсказки идут в
stderr. Это и есть язык, на котором с провайдером говорит агрегатор.

```console
$ adoc-autodoc brands 0986452041 --json
{"items":[{"brand":"BOSCH","article":"0986452041","name":"Фильтр масляный","rating":{"average":3.5714,"count":7},"images":["https://images.autodoc.ru/goods/30/0986452041/med_00_30_0986452041_defaf204-21d2-45f5-ade4-69b68e7441a9.webp"],"extra":{"manufacturerId":30}},{"brand":"TOYOTA","article":"0986452041","images":[],"extra":{"manufacturerId":579}}]}
```

Ошибка приходит тем же способом — телом `{"error":{"code","message"}}` в stdout
(без `--json` — текстом в stderr):

```console
$ adoc-autodoc offers n90954802 --brand VAG --json
{"error":{"code":"auth","message":"/api/price-service/price-list/originals: нужен вход — запусти `adoc login`"}}
```

| код | exit | когда |
|---|---|---|
| — | `0` | успех; пустой результат (`{"items":[]}`) — тоже успех |
| `auth` | `1` | нужен вход |
| `http` | `1` | сайт ответил ошибкой |
| `notfound` | `1` | артикул, бренд или позиция не найдены |
| `tty` | `1` | `login` без терминала |
| `timeout` | `1` | сайт не ответил вовремя |
| `bad_args` | `1` | неверные аргументы или неизвестная команда |
| `internal` | `1` | всё остальное |
| `ambiguous` | `2` | бренд не определён; варианты — в `items` тела ошибки |

Формы ответов, типы и правила для провайдеров — [docs/contract.md](docs/contract.md).

## Авторизация

```sh
$ adoc-autodoc login      # логин и пароль, ввод только с терминала
$ adoc-autodoc whoami     # кто авторизован
$ adoc-autodoc logout     # забыть аккаунт
```

Есть путь без пароля: в консоли браузера на сайте с открытой сессией —
`copy(JSON.stringify(sessionStorage))`, вставка — в `adoc-autodoc login --paste`.

Токены лежат в `~/.config/adoc/accounts/autodoc.json` с правами `600` и
обновляются сами. Каталог переопределяется `$ADOC_CONFIG_DIR`, иначе берётся
`$XDG_CONFIG_HOME/adoc`. Старый `token.json` от версии 1 переносится в новый
файл автоматически при первом запуске.

`login --json` печатает сохранённый аккаунт целиком, вместе с токенами — не
логируй этот вывод и никуда его не пересылай.

## Разработка

```sh
$ bun test
$ bun run typecheck
```

Тесты не ходят в сеть и не трогают настоящий конфиг: они подставляют
`ADOC_CONFIG_DIR` во временный каталог и `ADOC_FIXTURES` — каталог с
записанными ответами.

`ADOC_FIXTURES=<каталог>` работает и вручную: провайдер autodoc тогда читает
ответы с диска вместо `web.autodoc.ru`. Имя файла — метод и путь запроса, где
`/` заменены на `_`: `GET /api/goods-service/goods/info` →
`GET__api_goods-service_goods_info.json`. Готовые ответы лежат в
`test/fixtures/autodoc/http/`.

```sh
$ ADOC_FIXTURES=test/fixtures/autodoc/http adoc-autodoc info n90954802
```

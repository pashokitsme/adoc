# Armtek web API — неофициальная документация

Публичной документации у armtek.ru нет: `/swagger`, `/openapi.json`,
`/rest/ru/swagger` отдают 404. Всё ниже восстановлено из фронтенда и проверено
запросами. Дата сверки — 2026-09-02.

Каждый вызов помечен:

- **[проверено]** — запрос реально выполнен против прода и ответ разобран;
- **[из бандла]** — путь, метод и форма тела сняты с фронта, но живьём не звались.

Инференс без пометки не приводится: непроверенный факт, выданный за
проверенный, дороже честного пробела.

## Как это было получено

Воспроизводимо, без рендеринга SPA:

```bash
curl -s https://armtek.ru/product/<любой-алиас> -o product.html
grep -oE 'chunk-[A-Z0-9]{8}\.js' product.html | sort -u        # первый слой чанков
# скачать их, снова грепнуть chunk-*.js внутри — карта транзитивная (332 файла, 11 МБ)
grep -oh 'setUrl(.\{0,140\}' *.js | sort -u                    # пути + метод + тело
```

Фронт — Angular; HTTP-клиент собран билдером
`create().setUrl("<путь>").setMethod("<METHOD>").setData({…})`, поэтому из
бандла достаются не только пути, но и метод и форма тела. Так собран индекс в
конце документа — 294 вызова по 37 сервисам.

## Хосты

| Хост | Что это |
|---|---|
| `https://armtek.ru/rest/ru/` | **основной API** — всё, что ниже |
| `https://armtek.ru` | SPA (Angular), она же карточки товаров |
| `https://img.armtek.ru` | фотографии товаров и логотипы брендов |

Сегмент `ru` в пути — язык интерфейса, не страна: страна задаётся полем
`VKORG` в теле запроса.

## Соглашения

- **Конверт.** Любой ответ — `{"data": …, "arr_messages": [], "execution_time":
  {"seconds": …, "milliseconds": …}}`. Ошибки приходят HTTP-статусом, а текст
  для человека — в `arr_messages[]` с `"type": "E"`. Валидация полей отвечает
  **200 или 400 с `data: null`** и списком сообщений, поэтому проверять надо и
  статус, и `arr_messages`.
- **Утечка в сообщениях.** Каждый элемент `arr_messages` несёт `login` (телефон
  вошедшего) и `ip` клиента. Наружу такие тексты класть нельзя как есть.
- **Заголовки фронта.** В каждый запрос идут две константы из бандла:
  `X-AUTH-SYSTEM: AUTH_MICROSERVICE_V1_ARMTEK_RU` и
  `X-AUTH-TOKEN: nJhNK87gJOOU6dfr`. Без них `auth-microservice` отвечает 401
  даже на выдачу гостевого токена.
- **Авторизация.** `Authorization: Bearer <accessToken>`; для обновления —
  `Bearer <refreshToken>`. Без входа берётся гостевой токен (ниже), с ним
  работают поиск, отзывы и список точек выдачи.
- Ключи полей выдачи — **UPPER_SNAKE** (`PIN`, `BRAND`, `PRICES1`), ключи тел
  запросов — **lowerCamel** (`keyzak`, `kwmeng`, `numZak`). Регистр значим.
- Пагинация — объект `pagination` (в поиске) или `paginator` (везде ещё):
  `{currentPage, perPage, totalCount, pageCount}`, страницы с единицы.

## Авторизация

### Гостевой токен — `POST auth-microservice/v1/guest` **[проверено]**

```bash
curl -s -X POST https://armtek.ru/rest/ru/auth-microservice/v1/guest \
  -H 'X-AUTH-SYSTEM: AUTH_MICROSERVICE_V1_ARMTEK_RU' \
  -H 'X-AUTH-TOKEN: nJhNK87gJOOU6dfr' \
  -H 'Content-Type: application/json' -d '{}'
```

→ `{"data":{"accessToken":"<JWT>"},"arr_messages":[],"execution_time":{…}}`

Клеймы гостевого токена (подпись не проверяем, читаем только `exp`):

```json
{"exp":1819408495,"key":"…","type":"g9X",
 "data":{"login":"GUEST_…","uuid":"G…","utype":"G","ufunction":null,"aclSchemeType":"[…]"}}
```

`exp` — **примерно год** вперёд, так что токен имеет смысл кэшировать.
`utype: "G"` — гость. Гостевым токеном **нельзя** ходить в `auth-microservice`
и `client-microservice`: они отвечают 401 «Jwt токен не валиден: тип jwt токена».

### Вход — `POST auth-microservice/v1/auth/login` **[проверено]**

Тело `{"login": "<телефон 7XXXXXXXXXX или e-mail>", "password": "<пароль>"}`,
те же два заголовка фронта. Токен в запросе не нужен.

→ `{"data":{"accessToken":"<JWT>","refreshToken":"<JWT>"},"arr_messages":[]}`

Клеймы access-токена:

```json
{"exp":…,"key":"…","type":"d9X",
 "data":{"login":"7…","uuid":"R…","utype":"R","ufunction":null,"loginSapId":null,
         "clientId":"<hex32>","clientSapId":<число>,"reqnum":200,
         "aclSchemeType":"[…]","changePassword":false,"supplierPortal":false,
         "identificationType":"phone"}}
```

Сроки жизни, снятые с живой пары: **access — 2 суток**, **refresh — 3 месяца**.
`identificationType` показывает, чем вошли (`phone`); e-mail в поле `login`
принимается тоже — фронт шлёт в `login` и то, и другое, отдельного эндпоинта
для почты нет.

Неверная пара — **401 с пустым `arr_messages`**: внятный текст ошибки клиенту
придётся сочинять самому. Есть необязательные заголовки `X-AUTH-CAPTCHA-HASH`
и `X-AUTH-CAPTCHA-CODE` **[из бандла]** — на обычном входе не потребовались.

Помимо пароля фронт умеет вход по звонку/SMS
(`auth-microservice/v1/auth/login-phone/*`) **[из бандла]** — для CLI не нужен.

### Обновление — `POST auth-microservice/v1/auth/refresh` **[проверено]**

Заголовок `Authorization: Bearer <refreshToken>`, тело `{}`.

→ `{"data":{"accessToken":"<JWT>","refreshToken":"<JWT>"}}`

**Refresh ротируется**: старый после обмена держать бессмысленно, новый
обязателен к сохранению.

### Профиль

- `GET auth-microservice/v1/profile` **[проверено]** → `data.profile`:
  `{login, type, function, checkPasswordSapData}`. Ни имени, ни почты — только
  учётные поля.
- `GET client-microservice/v1/client/individual/get-client` **[проверено]** —
  вот это настоящая карточка клиента:

```json
{"CLIENT_ID":"<hex32>","CLIENT_SAP_ID":<число>,"CLIENT_CRM_ID":<число>,
 "FIRST_NAME":"…","MIDDLE_NAME":"","LAST_NAME":"","BIRTHDAY":null,
 "EMAILS":[{"ID":…,"EMAIL":"…","MAIN":true,"VERIFY":true}],
 "PHONES":[{"ID":…,"PHONE_NUMBER_FULL":"7…","MAIN":true,"VERIFY":true}],
 "VSTEL":"ME86",
 "VSTEL_DATA":{"vstel":"ME86","vkorg":"4000","vstxt":"…","adress":"…"},
 "VSBED":{"VSBED":"06","VTEXT":"Бесплатная доставка"},
 "ADDITIONAL":{"CLIENT_TYPE":"R","IS_CLIENT_INDIVIDUAL":true,
               "CLIENT_SEGMENT":"51","CLIENT_CATEGORY":"KR"},
 "CLIENT_STATUS":{"STATUS":"05","TEXT":"Новичок"},
 "SAP":{…}}
```

Отсюда берутся имя, почта, телефон для `whoami` и — важнее — **точка выдачи
аккаунта** (`VSTEL_DATA.vstel`) и его сбытовая организация
(`VSTEL_DATA.vkorg`): от них зависят цены, сроки и наличие в поиске.

`GET client-microservice/v1/client/personal-data` без параметров отвечает 400
и перечисляет обязательные: `vkorg`, `project`, `section` **[проверено]**.

### Выход

`POST auth-microservice/v1/auth/logout` **[из бандла]**. Провайдер его не
зовёт: `logout` в SDK только удаляет файл аккаунта, а серверная сессия здесь —
это сам JWT, который после удаления файла всё равно недостижим.

## Поиск — `POST search-microservice/v1/search` **[проверено]**

Один эндпоинт обслуживает и поиск по артикулу, и поиск по названию.

```json
{"query": "0986452041",
 "queryType": 1,
 "page": 1,
 "userInfo": {"VKORG": "4000", "VSTELS_LIST": ["ME86"]},
 "ZZSIGN": "S"}
```

| Поле | Смысл |
|---|---|
| `query` | артикул или текст; регистр и разделители в артикуле игнорируются |
| `queryType` | `1` — точные совпадения **плюс аналоги**; `2` (и `3`) — только точные. `0` → 400 |
| `page` | страница с единицы |
| `typeView` | необязательное; `"list"` или `"card"` — форма выдачи, см. ниже |
| `userInfo.VKORG` | сбытовая организация: `4000` Россия, `2000` Беларусь, `8000` Казахстан |
| `userInfo.VSTELS_LIST` | точки выдачи, от них зависят цена, наличие и срок. Обязателен |
| `ZZSIGN` | `"S"` — обычная продажа (фронт шлёт `"1"` для распродажных позиций) |

**`queryType` работает наоборот тому, что говорил дизайн-спек.** Проверено
дважды подряд на `0986452041`: `queryType: 1` → `totalCount` 557, `queryType: 2`
и `3` → `totalCount` 1 (только BOSCH, тот самый артикул). На артикулах без
аналогов в базе armtek (`MD360935`, `W712/75`, `0451103316`) обе формы дают
одно и то же — разница видна только там, где аналоги есть.

### Две формы выдачи: `typeView`

`typeView` есть и в ответе, и в запросе; сервер выбирает сам, но заданное в
теле значение перебивает выбор **[проверено]**.

- **`"list"`** — строка на пару (артикул, бренд), предложения вложены в
  `SUGGESTIONS[]`. То, что нужно и для `search`, и для `brands`/`offers`.
- **`"card"`** — строка на **отдельное предложение**: поля предложения слиты с
  полями артикула, `SUGGESTIONS` нет вовсе. Итоги разные: на «фильтр масляный»
  `list` даёт `totalCount` 997, `card` — 1313. Осторожно с названием: в этой
  форме `NAME` — это название **предложения** (`"фильтр масляный!\\ Mazda 626…"`),
  а человеческое лежит в `CUSTOM_NAME`.

Естественный выбор сервера непредсказуем («фильтр масляный» → `list`,
«щётка стеклоочистителя» → `card`), поэтому клиенту стоит **всегда явно слать
`typeView: "list"`**, иначе форма ответа зависит от текста запроса.

### Ответ (`typeView: "list"`)

```json
{"data":{"typeView":"list","cacheKey":"<hex>","searchByVin":true,"searchLiquids":true,
  "articlesData":[ … ],
  "pagination":{"currentPage":1,"perPage":36,"totalCount":557,"pageCount":16},
  "executionTime":0.42}}
```

Строка `articlesData[]`:

| Поле | Что это |
|---|---|
| `ARTID` | id артикула у armtek — ключ для отзывов и корзины |
| `PIN` | артикул **в форматировании производителя**: `"0 986 452 041"`, `"W 610/6"` |
| `BRAND`, `BRAND_ID`, `BRAND_ALIAS`, `BRAND_ICON` | бренд |
| `NAME` | название с брендом и применимостью |
| `ARTICLE_ALIAS` | слаг карточки товара, см. «URL карточки» |
| `PHOTO[]` | ссылки на `img.armtek.ru`, 230×230 |
| `RATING` | средняя оценка строкой (`"5"`), `""` если отзывов нет |
| `REVIEW_COUNT` | число отзывов |
| `SUGGESTIONS[]` | предложения по этой паре (артикул, бренд) |
| `FAV`, `FAV_ID` | в избранном ли; под гостевым токеном всегда `false`/`null` |
| `RSTP`, `AN_ID`, `MATERIAL_ID`, `REL`, `REL_AP`, `MJT_DATA`, `PROPS`, `GARANT`, `REC` | служебное |

`PIN` приходит с пробелами и слэшами, поэтому **сравнивать артикулы можно
только по нормализованному ключу** (выкинуть всё, кроме букв и цифр, привести к
верхнему регистру). Одна и та же нормализованная пара (PIN, BRAND) встречается
в выдаче ровно один раз; на `0986452041` из 557 строк 489 уникальных PIN —
остальные повторы это тот же артикул у других брендов.

Предложение `SUGGESTIONS[]`:

| Поле | Что это |
|---|---|
| `ARTID` | тот же id артикула |
| `PRICES1` | цена строкой, `"592.00"` |
| `PRICEP` | цена до скидки (перечёркнутая) |
| `PRICER1`, `PRICEW1`, `PRICEREC` | розничная / оптовая / рекомендованная |
| `RVALUE` | остаток строкой: `"1"`, но также **`">20"`** — не число |
| `DLVDT` | срок поставки, `YYYYMMDDHHmmss` |
| `ORDDT` | крайний срок заказа, тот же формат |
| `KEYZAK` | склад-источник (`"MOV0000019"`) |
| `NUMZAK` | номер схемы поставки |
| `PARNR`, `CHARG`, `POSNR`, `KWMENG` | партнёр, партия, позиция в корзине, количество в корзине |
| `TYPE` | `"BEST"`, `"CHEAP"`, `"FAST"` — метка сортировки |
| `WAERS` | валюта, `"RUB"` |
| `MINBM`, `VENSL`, `SCALES`, `GSORT`, `COLOR`, `RDPRF`, `XSPEC`, `AUTH_DEALER`, `WRNTDT` | служебное |
| `STOCKS[]`, `PROMO[]` | остатки по складам и акции |

Предложений на строку бывает 1–3 (проверено на выдаче из 557 строк).

Всё, что нужно для добавления в корзину — `ARTID`, `KEYZAK`, `PARNR`,
`NUMZAK`, `CHARG`, `PRICES1`, `PRICEP`, `WAERS`, `POSNR` — лежит в предложении.

### Пагинация **[проверено]**

`perPage` = 36 и в теле не меняется (`perPage`/`limit` в теле игнорируются);
`pageCount` = 16 на 557 позиций. Страницы обходятся `page: 1..pageCount`,
выдача стабильна между вызовами.

Точная выдача (`queryType: 2`) тоже бывает многостраничной: `MD360935`
выпускают 45 брендов, то есть две страницы. Клиент, читающий только первую,
теряет девять брендов из сорока пяти, поэтому провайдер добирает страницы —
до потолка в пять.

### Смежное **[из бандла]**

- `POST search-microservice/v1/search/all-suggestions`, тело
  `{artId, userInfo: {VKORG, VSTELS_LIST}, limitSuggestions: false}` — все
  предложения по одному артикулу, без обрезания до трёх.
- `search-microservice/v1/*` — ещё 25 вызовов (подсказки, история, VIN).

## URL карточки товара **[проверено]**

```
https://armtek.ru/product/<ARTICLE_ALIAS>
```

`ARTICLE_ALIAS` уже содержит `ARTID` хвостом
(`…-mitsubishi-galant-18-25i-91-55469`). Проверено: этот вид отдаёт 200,
а `/tovar/…`, `/catalog/…`, `/<alias>` и `/product/<бренд>/<alias>` — 404;
несуществующий алиас на `/product/` тоже 404, то есть это не заглушка SPA.

Без алиаса сайт подставляет в тот же маршрут `ARTID` (`/product/<ARTID>`) — так
делает его собственный шаблон карточки. Уценённая партия живёт отдельно:
`/product/markdown/<alias>/<charg>`.

### Остальные адреса **[из таблицы маршрутов Angular]**

| страница | адрес |
|---|---|
| корзина | `/basket` |
| заказы | `/profile/orders`; карточка — `/profile/orders/card?orderId=<VBELN>` или `?orderHash=<GUID>` |
| гараж, профиль, избранное | `/profile/garage`, `/profile/info`, `/profile/favorite` |
| поиск | `/search?text=<запрос>` |
| категория | `/category/<alias>` |

Отдельной страницы отзывов у товара нет: лента живёт на карточке и листается
скроллом (`scrollToReviews()`), якоря в адресе тоже нет.

## Подсказка и поиск по категории **[проверено]**

```
GET search-microservice/v1/autocomplete/search?type=3&query=фильтр%20масляный
```
```json
{"history":[],"suggest":[…],"article":[…],"brands":[…],
 "category":[{"ID":"8963","ALIAS":"filtry-maslyanye-8963","NAME":"Фильтры масляные",
              "PATH":[{"ID":"1266","NAME":"Автозапчасти","ALIAS":"avtomobili-1266"},…]}]}
```

```
POST search-microservice/v1/search/by-category
{"query":"<ALIAS категории>","page":1,"typeView":"list",
 "userInfo":{"VKORG":"4000","VSTELS_LIST":["ME86"]},
 "linkingTargetId":58759,"linkingTargetType":"P"}
```

Ответ той же формы, что у `v1/search` (`articlesData` с `SUGGESTIONS`).

### Поиск с учётом машины **[проверено]**

Это **единственная** ручка armtek, которая умеет фильтр по машине.
`linkingTargetId` — идентификатор модификации TecDoc, `linkingTargetType` —
`"P"` для легковых. Замеры на «фильтр масляный» → `filtry-maslyanye-8963`:

| запрос | всего |
|---|---|
| свободный поиск `v1/search`, без машины | 997 |
| `by-category` без машины | 53859 |
| `by-category` + `linkingTargetId=58759` (Octavia III 1.8 TSI) | **392** |
| `by-category` + `linkingTargetId=58750` (1.4 TSI) | 1029 |

Свободный поиск `POST v1/search` машину не принимает: `linkingTargetId` и
`linkingTargetType` он отбивает («Это поле не ожидалось»), а `indexedAutoId`
принимает и игнорирует — это идентификатор ленивой VIN-идентификации laximo
(`laximo-microservice/v1/unisearch/auto/identify`), и на нашем VIN она отдаёт
пустой список.

**`linkingTargetId` совпадает с `modificationId` из гаража autodoc** — оба
сайта сидят на TecDoc, поэтому провайдер принимает в `--car` ref с любым из
полей `linkingTargetId`, `modificationId` или `carId`: это одно и то же число.
Проверено живьём, что оба написания дают одну выдачу (392 позиции). Проверено:
`substitutes-microservice/v1/substitutes/get-vehicle-ids-and-car-info?manuId=106&modId=11195&linkingTargetType=P`
содержит `carId: 58759`, а `get-model-series` для SKODA отдаёт `modelId: 11195`
— те же числа, что у autodoc.

## Отзывы — `review-microservice/v2/*` **[проверено]**

Лента отзывов существует и **читается гостевым токеном**. Ключ — `artId`
(поле `ARTID` из выдачи поиска), не пара (артикул, бренд).

### `GET review-microservice/v2/review/get-list-by-artid`

Параметры: `artId`, `page`, `limit`, `published=true`,
`order[changedDate]=DESC`. Фронт умеет также `order[rating]=DESC|ASC` и
`order[availableImages]=DESC` **[из бандла]**.

```json
{"data":{"paginator":{"pageCount":1,"currentPage":1,"perPage":5,"totalCount":2},
 "items":[{"id":41129,"hash":"…","text":"Фильтр надежный, резинка плотная.",
   "rating":5,"ratingGpt":null,"artId":55469,"published":true,"isRemove":false,
   "customAnswer":null,"publishedAnswer":false,"points":null,
   "reviewValidationTypeName":"gpt","reviewTypeName":"product",
   "reviewStatusId":2,"reviewStatusName":"verified",
   "createdUser":"7…","firstName":"…","middleName":"…","lastName":"…",
   "createdDate":"2025-10-20 17:38:39","changedDate":"2025-10-20 17:38:39",
   "files":[]}]}}
```

**Осторожно с персональными данными:** `createdUser` — это телефон автора
отзыва, а `firstName`/`middleName`/`lastName` — его ФИО целиком. В фикстуры и
в выдачу контракта эти поля класть нельзя. Полей «достоинства»/«недостатки» у
armtek нет — отзыв это один `text` и `rating` 1–5.

### `GET review-microservice/v2/review/get-rating-by-artids?artids[]=<ARTID>`

```json
{"data":[{"artId":55469,"reviewCount":2,"rating":"5.0",
  "fiveStarsCount":2,"fourStarsCount":0,"threeStarsCount":0,
  "twoStarsCount":0,"oneStarsCount":0,"active":true}]}
```

Готовая гистограмма от 5★ к 1★ — ровно то, чего просит `Reviews.rating`.
Параметр — массив, но фронт всегда шлёт один элемент.

Остальное в сервисе — про свои отзывы и их создание **[из бандла]**:
`get-list-by-client-id`, `get-list-by-login`, `get-received-positions`,
`resource/get-list`, `POST review-microservice/v2/review`,
`POST review-microservice/v2/review/set-is-remove/<id>`,
`POST review-microservice/v2/review/uploader/upload-file`.

## Точки выдачи — `GET delivery-microservice/v1/custom-vstel/list` **[проверено]**

Параметры: `search=<текст>`, `viewAll=true`.

```json
{"data":{"paginator":{"currentPage":1,"perPage":50,"totalCount":50,"pageCount":1},
 "items":[{"vname":"Москва МКАД 86 км","vstel":"ME86","alias":"moskva-mkad-86-km-me86",
   "adress":"141031, Московская обл., …","phone":"*7600","email":"info@armtek.ru",
   "remark":"Пн - Пт 08:00 - 17:00, …","geolat":"55.906885000000","geolon":"37.611043000000",
   "typobj":"Региональный склад-магазин","vkorg":4000,"isActive":true,"isPickup":false,
   "schedule":{"restrictions":[{"time_from":{"hours":8,"minutes":0},
                                "time_to":{"hours":17,"minutes":0},"days":[1]}]}}]}}
```

Под гостевым токеном отдаётся ровно 50 точек (`totalCount` тоже 50), несмотря
на `viewAll=true`; `perPage` в запросе не увеличивает выдачу. `vkorg` в
элементах — `4000`, `2000`, `8000`. Поиск по названию города работает:
`search=Москва` → 14 точек.

Значение по умолчанию у фронта — `ME86` («Москва МКАД 86 км», `vkorg` 4000);
у вошедшего клиента вместо него надо брать `VSTEL_DATA` из карточки клиента.

## Корзина — `cart-microservice/v1/*` **[проверено]**

Круговой проход «добавить → изменить количество → убрать» выполнен на живом
аккаунте; после него корзина проверена пустой двумя разными вызовами.

### Заголовок `X-CA-VKORG` — ловушка

`GET cart-microservice/v1/base` **молча отдаёт пустую корзину**, если не
прислать заголовок `X-CA-VKORG: <vkorg>`. Не 400, не сообщение в
`arr_messages` — ровно `{"items":[],"codes":[]}`, неотличимое от честно пустой
корзины. Проверено: тот же запрос с заголовком возвращает позицию, а
`cart/items-total-count` в это же время видит её и без заголовка.

Тот же заголовок фронт шлёт и в остальные вызовы корзины, доставки и заказов.
`vkorg` **в query** этот вызов не принимает вовсе: `?vkorg=4000` — **417**.

### `GET cart-microservice/v1/base` — что в корзине

Query: `vstels[]=<VSTEL>` (обязателен; пустое значение — 417),
необязательные `clientCategory` и `clientSegment` из `ADDITIONAL` карточки
клиента. Заголовок `X-CA-VKORG` обязателен, см. выше.

→ `data: {items: [...], codes: []}`. **Итога в ответе нет** — сумму считает
клиент. Позиция:

```json
{"posnr":1,"artid":55469,"keyzak":"MOV0000019","parnr":0,"kwmeng":1,
 "prices":592,"prices1":"592.00","pricep":"624.00","pricem":592,"priceb":0,
 "oldPrices":"592.00","waers":"RUB","numZak":"1",
 "dateDel":"20260902","timeDel":"043000","orddt":"20260902030000","wrntdt":"",
 "vstels":"ME86","zzsign":"S","charg":"","status":"","comments":"","podbor":"",
 "dateSt":"20260902","timeSt":"023037","dateUpd":"…","timeUpd":"…",
 "minbm":1,"rvalue":"46","rdprf":"1","saleCode":0,"parentPosnr":null,
 "brand":"BOSCH","pin":"0 986 452 041","name":"фильтр масляный…",
 "brandAlias":"bosch-934","articleAlias":"filtr-maslyanyy-bosch-…-55469",
 "photo":["https://img.armtek.ru/…"],"brandIcon":"…",
 "brgew":"258.000","laeng":"101.000","breit":"70.000","hoehe":"70.000",
 "categories":[8963,11132],"points":{"value":0,"rule":{…}},"fav":false}
```

`posnr` — id позиции внутри корзины, им же она удаляется и обновляется.
Любопытное: `rvalue` здесь настоящий остаток (`"46"`), тогда как поиск на том
же складе показывал `">20"`.

### `POST cart-microservice/v1/base` — добавить

```json
{"vkorg": "4000",
 "items": [{"keyzak": "MOV0000019", "parnr": 0, "artid": 55469, "kwmeng": 1,
            "numZak": "1", "prices": 592, "pricem": 624,
            "waers": "RUB", "vstels": "ME86", "charg": "", "zzsign": "S",
            "comments": "", "podbor": "", "status": "", "saleCode": 0,
            "parentPosnr": null, "parentArtid": null, "posnr": 0}]}
```

Числовые поля идут **числами**, хотя в выдаче поиска они строки
(`+PARNR`, `+ARTID`, `+PRICES1`, `+PRICEP`). `posnr: 0` — «этой позиции в
корзине ещё нет».

→ `data.items[]` — только затронутые позиции:
`{"vbeln":<номер корзины>,"posnr":1,"artid":…,"keyzak":"…","kwmeng":1,"parentPosnr":0,"comments":"","status":""}`

**POST по существующему `posnr` отвечает 400** — добавление и изменение не
взаимозаменяемы.

### `PUT cart-microservice/v1/base` — изменить количество

Тело то же, но `posnr` — существующий, `kwmeng` — новое количество. Ответ той
же формы, что у POST. Проверено: `kwmeng` 1 → 2 меняется и виден в `GET base`.

### `DELETE cart-microservice/v1/base` — убрать

Тело `{"vkorg": "4000", "posnr": [1]}` (массив). → `data: true`.

### `GET cart-microservice/v1/cart/items-total-count?vkorg=<vkorg>`

`vkorg` в query **обязателен**, иначе 400. → `{"count": 1, "items":
[{"artid": …, "posnr": …, "keyzak": "…", "kwmeng": 1}]}`. Годится как дешёвая
проверка «пуста ли корзина» — заголовок `X-CA-VKORG` ей не нужен.

### Прочее в сервисе

- `GET cart-microservice/v1/basket` — корзина ЭТП (B2B), просит `login` и
  `kunag`; для розничного аккаунта не наш путь **[проверено, 400]**.
- `POST cart/copy`, `POST cart/clear-discount`,
  `GET cart/check-discount?vkorg=&vstels[]=&code=` **[из бандла]**.

## Гараж — `garage/v2/*` и `task-selection-microservice`

- `GET task-selection-microservice/v1/garage/get-transport-list-by-filter?client_id=<CLIENT_ID>`
  **[проверено]** — `client_id` берётся из клейма `data.clientId` access-токена
  или из `CLIENT_ID` карточки клиента. На пустом гараже →
  `{"garageTypes":[],"transportList":[],"collectionList":{"data":[]}}`.
  **Форма непустой машины не проверена**: у тестового аккаунта гараж пуст, а
  добавлять машину владелец не разрешал.
- `GET garage/v2/get-transport-types-list` **[проверено]** → справочник:
  `[{"id":1,"title":"Легковой автомобиль","key":"Car","position":1,"active":1,
  "linking_target_type":"P"}, … Truck, Bus, Trailer, SpecialMachinery, Motorcycle]`.
- `GET garage/v2/get-transport?transport_id=<id>` **[из бандла]**
- `GET garage/v2/history-by-vin?vin=<vin>` **[из бандла]**
- `GET task-selection-microservice/v1/garage/get-data-by-vin-code-extended?vin=<vin>` **[из бандла]**
- пишущие **[из бандла]**: `POST garage/v2/add-transport`,
  `PUT garage/v2/update-transport`, `DELETE garage/v2/del-transport`,
  `POST garage/v2/upload-transport-file`, `…/upload-transport-image`.

## Заказы — `order-microservice/v1/*` **[форма — из бандла]**

> **Форма заказа живьём не проверена.** У аккаунта заказов нет: ручка отвечает
> `ORDER: []`. Проверен только сам вызов и конверт ответа; **все поля строки
> заказа и позиции ниже сняты из бандла фронта**, а не с настоящего ответа.
> Не считать их подтверждёнными.

`GET order-microservice/v1/order/report` **[вызов проверен]** — список заказов; это
его зовёт страница `/profile/orders`. `GET order-microservice/v1/order/get-info`
— карточка одного заказа.

Без параметров ответ приходит конвертом со страницей:

```json
{"KEY":"<кэш>","TTL":0,"PAGE":1,"PAGE_TTL":0,"ORDER":[]}
```

Параметры из фронта: `dateFrom`, `dateTo` (`YYYY-MM-DD`), `page`, `vkorg`, а
также флаги состояния `created`, `inProgress`, `closed`, `rejected` (по
единице). **Ловушка:** `dateFrom` и `dateTo` сервер принимает по отдельности, а
любую их пару отбивает «`dateFrom`: Значение не является правильной датой» —
поэтому провайдер дат не шлёт вовсе.

**Форма заказа взята из бандла** (`chunk-FZVGACXA.js`) **[из бандла]**, а не с
ответа: строка `ORDER[]` — `VBELN` (номер),
`GUID`, `date`/`ORDER_DATE`/`CREDT`, `ORDER_STATUS`, `ORDER_STATUS_ALIAS`,
`NETWR` (сумма), `PAYMENT_STATUS`, `PAYMENT_TYPE`, `ITEMS[]`; позиция —
`ARTID`, `PIN`, `BRAND`, `NAME`/`ARTICLE_NAME`, `ARTICLE_ALIAS`, `KWMENG`,
`PRICE`, `NETWR`, `POSITION_STATUS`, `CHARG`.

Остальное **[из бандла]**: `…/order/get-full-position-statuses`, `…/delivery`,
`…/proforma`, `…/order/report/purchases`, `…/order/positions/cancel`;
создание заказа — `POST order-microservice/v1/claim/create`, оплата —
`POST order-microservice/v1/order/payment/create`. Ничего из пишущего не
трогалось.

## Отзывы аккаунта **[проверено]**

- `GET review-microservice/v2/review/get-list-by-client-id?clientId=<CLIENT_ID>&page=1&isRemove=false`
  → `{"paginator":{…},"items":[]}` на аккаунте без отзывов.
- `GET review-microservice/v2/review/get-received-positions?vstelList[]=<VSTEL>`
  → `[]` — товары, на которые можно оставить отзыв (то есть полученные).

## Что провайдер уже умеет

Контракт закрыт целиком: `login`, `logout`, `whoami`, `search`
(в том числе `--car`), `brands`, `offers` (с `--analogs`), `info`, `analogs`,
`reviews`, `orders`, `basket` (список, add, set, rm), `garage export`.
Capabilities — `reviews`, `garage`, `analogs`, `basket`, `orders`.
Сверх контракта: `vstel [поиск]`, `raw <METHOD> <путь> [k=v…] [--body <json>]`.

Как сырые поля ложатся в контракт:

| контракт | откуда | оговорка |
|---|---|---|
| `Product.price`, `Offer.price` | `PRICES1` | строка, `""` — это «нет цены», а не ноль: строка без цены предложением не считается и в выдачу не идёт |
| `Offer.deliveryDate` | `DLVDT` → `YYYY-MM-DD` | пустая дата SAP (`"00000000"`) и несуществующие числа — не дата: срока просто нет |
| `Offer.deliveryDays` | `DLVDT` минус сегодня, **по календарным датам** | прошедшая дата даёт 0, не минус |
| `quantity` | `RVALUE` | строка; `">20"` → 20 плюс `extra.quantityAtLeast: true` |
| `Offer.seller` | константа `armtek` | продавец везде один, а человекочитаемого названия склада сайт не отдаёт |
| `extra.keyzak` | `KEYZAK` | код склада; `Offer.stock` не заполняется — в контракте это код со своим названием, а названия нет |
| `Offer.analog` | сравнение `articleKey`/`brandKey` с запрошенной парой | |
| `Offer.ref` | `ARTID`, `KEYZAK`, `PARNR`, `NUMZAK`, `PRICES1`, `PRICEP`, `WAERS`, `CHARG`, `MINBM`, `VSTEL` | этого хватает, чтобы собрать тело POST корзины без второго запроса |
| `BasketItem.id` | `posnr` | им же идут PUT и DELETE |
| `Reviews.rating.histogram` | `get-rating-by-artids`, от 5★ к 1★ | |
| `Review.author` | `firstName` плюс первая буква `lastName` | телефон и полное ФИО наружу не отдаём |
| `Car.*` | `brand`/`model_name`/`manufacture_year` — объекты `{value}`; пробег и двигатель — в `options[]` по ключам `mileage`, `engine_capacity`, `engine_type` | строки с `active !== "1"` пропускаем |
| `offers --analogs` | `queryType: 1`, **ровно одна страница** из `pagination.pageCount` (на `0986452041` это 36 позиций из 557) | `--page` контракт для `offers` не предусматривает, поэтому о неполноте провайдер говорит в stderr через `ctx.warn`: сколько страниц есть и какая отдана. В stdout при `--json` по-прежнему ровно один объект |
| `brands`, выбор бренда | страницы `queryType: 2` добираются до потолка в 5 (180 строк) | упёрлись в потолок — то же предупреждение в stderr: список брендов неполный |
| `Product.url`, `Offer.url`, `BrandHit.url`, `BasketItem.url`, `Reviews.url` | `ARTICLE_ALIAS`, иначе `ARTID` | у уценённой партии — `/product/markdown/<alias>/<charg>`; отдельной страницы отзывов у сайта нет, поэтому `Reviews.url` — та же карточка |
| `Info.*` | форма `card`: `CUSTOM_NAME`, минимум `PRICES1`, минимум срока по `DLVDT`, `KEYZAK` в `stock[].code` | человеческого названия склада сайт не отдаёт, поэтому `stock[].name` пустое |
| `search --car` | `search/by-category` с `linkingTargetId` | ref принимает `linkingTargetId`, `modificationId` и `carId` как одно и то же число (модификация TecDoc) и `linkingTargetType` (по умолчанию `"P"`); ref без такого числа — предупреждение в stderr и обычный поиск |
| `Order.*` | `order/report` | **форма из бандла**: живых заказов на аккаунте нет, маппер написан мягко и живьём не проверен |

Неоднозначности: бренд, которого нет среди точных совпадений, — ошибка
`ambiguous` со списком брендов (exit 2); артикул, которого нет вовсе, —
`notfound`.

Вход без терминала: `login` берёт `ARMTEK_PHONE` и `ARMTEK_PASSWORD` из
окружения, когда заданы обе переменные, иначе спрашивает в tty. Пароль на диск
не попадает; в `accounts/armtek.json` лежат только `access`, `refresh`,
`expires`, `vkorg`, `vstel`, `clientId`, `category`, `segment` и кэш гостевого
токена.

## Фикстуры

`test/fixtures/armtek/` — реальные ответы от 2026-09-02, вычищенные:
`search-list.json`, `search-card.json`, `search-brand-group.json`,
`search-exact-bosch.json`, `search-analogs-paged.json`, `guest-token.json`,
`reviews-list.json`, `reviews-rating.json`, `cart-list.json`, `cart-add.json`,
`cart-put.json`, `cart-delete.json`, `vstel-list.json`, `garage-empty.json`,
`error-validation.json`, `autocomplete.json`, `search-by-category.json`
(с `linkingTargetId=58759`), `search-card-bosch.json`, `orders-empty.json`
и четыре синтетических (у каждого причина в `_note` первой строкой файла):
`client.json` (настоящая карточка клиента состоит из персональных данных
целиком), `garage-cars.json` (гараж аккаунта пуст, форма собрана из бандла
фронта), `orders.json` (заказов на аккаунте нет, поля взяты из бандла) и
`search-exact-overflow.json` (страниц точной выдачи больше потолка
`MAX_PAGES`, чтобы проверить предупреждение о неполном списке брендов).

## Что ещё есть в бандле

294 вызова по 37 сервисам. Крупнейшие: `auth-microservice` (28),
`client-microservice` (27), `search-microservice` (27),
`assortment-microservice` (21, карточка товара и характеристики),
`content-microservice` (17), `laximo-microservice` (15, оригинальные каталоги),
`order-microservice` (15), `substitutes-microservice` (13, замены),
`balance-microservice` (12), `refund-microservice` (11),
`tires-and-wheels-microservice` (10), `delivery-microservice` (9),
`review-microservice` (9). Далее по мелочи: `garage` (7),
`catalog-auto-microservice` (6), `mjt-microservice` (6), `cart-microservice` (5),
`favorites` (5), `feedback-microservice` (5), `point-microservice` (5),
`payment-microservice` (4) и ещё 15 сервисов по 1–3 вызова.

Полезное для карточки товара **[из бандла]**:
`GET assortment-microservice/v1/articles/details/alias/<ARTICLE_ALIAS>?weightUnitType=kg&lengthUnitType=cm&country=<домен>`.

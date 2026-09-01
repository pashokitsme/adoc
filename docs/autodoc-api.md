# Autodoc web API — неофициальная документация

Публичной документации у autodoc.ru нет: `/swagger`, `/swagger/v1/swagger.json`,
`/openapi.json`, `/Help` отдают 404 и на `web.autodoc.ru`, и на
`webapi.autodoc.ru`. Всё ниже восстановлено из фронтенда и проверено запросами.
Дата сверки — 2026-09-01.

API не является внутренним в смысле «скрытый и привилегированный»: чтение
каталога, карточек и отзывов работает без ключа и без авторизации. Но он
недокументирован и ничем не обязан сохранять совместимость — считать его
стабильным контрактом нельзя.

## Как это было получено

Воспроизводимо, без рендеринга SPA:

```bash
curl -s https://www.autodoc.ru/ -o index.html                  # Angular, <a-root>
grep -oE '"\./chunk-[A-Z0-9]{8}\.js"' main-*.js                # карта ленивых чанков
# скачать все 106 чанков (~1.7 МБ) и грепать по ним
grep -ohE '\$\{this\.basePath\}/api/[^`]+' *.js                # пути
grep -ohE 'name:"prod".{0,300}' *.js                           # конфигурация окружения
curl -s https://www.autodoc.ru/assets/config/config.json       # рантайм-конфиг
curl -s https://login.autodoc.ru/.well-known/openid-configuration
```

Клиент сгенерирован из OpenAPI (видно по форме `addToHttpParams(p, x, "Name")`),
поэтому из бандла достаются не только пути, но и HTTP-метод и имена query-параметров.
Именно так собран индекс в конце документа — 214 вызовов.

Отдельно стоит отметить оракул для перебора: несуществующий путь на
`webapi.autodoc.ru` отвечает JSON-ом
`{"message":"No HTTP resource was found that matches the request URI '...'"}`,
то есть отличает «нет такого роута» от «роут есть, аргументы не те».

## Хосты

| Хост | Что это |
|---|---|
| `https://web.autodoc.ru` | **основной API** (`apiUrl`, `marketingApiUrl`) — всё, что ниже |
| `https://login.autodoc.ru` | IdentityServer, OIDC (`authApi`) |
| `https://www.autodoc.ru` | SPA (Angular), она же зарегистрированный redirect_uri |
| `https://webapi.autodoc.ru` | легаси-API, в конфиге лежит как `externalApis.webapi` |
| `https://cataloguniversal.autodoc.ru` | картинки категорий универсального каталога |
| `https://images.autodoc.ru`, `https://file.autodoc.ru` | изображения товаров и файлы |

Рантайм-конфиг фронта: `https://www.autodoc.ru/assets/config/config.json`
```json
{"appUrl":"https://www.autodoc.ru","webApiNew":"https://web.autodoc.ru","authApi":"https://login.autodoc.ru"}
```

## Авторизация

OpenIddict (видно по `error_uri: https://documentation.openiddict.com/errors/...`),
discovery: `https://login.autodoc.ru/.well-known/openid-configuration`

| | |
|---|---|
| `client_id` | `Angular` — публичный клиент, **без секрета** |
| Рабочий поток для CLI | `password` (ROPC) — проверено, грант принимается |
| Поток фронта | `authorization_code` + PKCE (`S256`) |
| `authorization_endpoint` | `https://login.autodoc.ru/connect/authorize` |
| `token_endpoint` | `https://login.autodoc.ru/connect/token` |
| `userinfo_endpoint` | `https://login.autodoc.ru/connect/userinfo` |
| `end_session_endpoint` | `https://login.autodoc.ru/connect/endsession` |
| Единственный принятый `redirect_uri` | `https://www.autodoc.ru` |

Проверено: `http://localhost:4200`, `http://localhost:8765/callback` и любой
посторонний хост отбиваются редиректом на `/Error?httpStatusCode=400`. Поднять
локальный колбэк-сервер нельзя — вход обязан пройти через SPA.

**PKCE для стороннего клиента нерабочий.** Пройти по собственной ссылке
`connect/authorize` можно, но редирект приходит в SPA, а её oidc-клиент этого
`state` не инициировал и падает с `could not find matching config for state`,
не отдав код наружу. Практический вывод: сторонним клиентам остаётся ROPC.

```bash
curl -X POST https://login.autodoc.ru/connect/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=password' \
  --data-urlencode 'client_id=Angular' \
  --data-urlencode 'scope=openid profile offline_access' \
  --data-urlencode 'username=<телефон или email>' \
  --data-urlencode 'password=<пароль>'
```

Несуществующий пользователь даёт `400 invalid_grant` с описанием
«Клиент не найден» — это про покупателя, не про OAuth-клиента. Запрещённый
грант дал бы `unsupported_grant_type`, так что `password` для клиента
`Angular` включён.

Заявленные грант-типы: `authorization_code`, `implicit`, `password`,
`client_credentials`, `refresh_token`, `device_code`, `token-exchange`,
`InternalTokenExchange`, `SwitchLogin`. Discovery объявляет
`device_authorization_endpoint: https://login.autodoc.ru/device`, но POST на него
отдаёт 302 — для клиента `Angular` device flow фактически недоступен.

Скоупы: `openid offline_access email profile phone roles address` плюс по одному
на сервис — `AccountService IdentityService AdministrationService ProductService
BasketService ClientService OrderService FavoriteService GarageService
DeliveryService CatalogMaintenanceService CompanyService CatalogUniversalService
PromoService LogbookService ChatService CatalogOriginalService`.

Фронт хранит результат в `sessionStorage` (библиотека `angular-auth-oidc-client`),
ключи `authnResult` (там `access_token` и `refresh_token`), `authzData`,
`userData`, `authStateControl`, `authNonce`.

Обновление токена — обычный `refresh_token` grant:

```bash
curl -X POST https://login.autodoc.ru/connect/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=refresh_token&client_id=Angular&refresh_token=<TOKEN>'
```

Дальше во все запросы: `Authorization: Bearer <access_token>`.

## Соглашения

- Query-параметры почти везде **PascalCase** (`Article`, `ManufacturerId`,
  `PageNumber`, `MaxResultCount`). Исключения существуют: у
  `price-service/search/manufacturers` параметр называется `article` со строчной,
  у `favorites/copy-list` — `publicToken`, у `favorites/search` — `searchText`.
  Регистр значим.
- Пагинация: `PageNumber` (с единицы) и `MaxResultCount`.
- Часть POST-ов принимает параметры **в query, а не в теле** — например
  `catalog-universal-goods/find-goods` и `catalog-universal-categories/search`.
  Тело при этом всё равно должно быть валидным JSON (`{}`).
- Артикул регистронезависим: `n90954802` и `N90954802` дают одно и то же.
- Удаление корзины сделано через `HttpClient.request()` с телом, а не через
  `DELETE` — в индексе такие строки помечены как `REQUEST`.
- Ошибки авторизации приходят как **401 с пустым телом**, без JSON.

## Проверенные вызовы

Ниже — то, что реально выполнено против прода 2026-09-01. Сквозной пример:
артикул `N90954802`.

### Поиск по артикулу → производители

```
GET /api/price-service/search/manufacturers?article=n90954802
```
```json
{"items":[{"article":"N90954802","manufacturer":{"name":"VAG","id":657},
  "goodsName":"Болт","imageUrl":"https://images.autodoc.ru/goods/657/N90954802/med_...webp"}]}
```

Один артикул может принадлежать нескольким производителям — отсюда и берётся
`ManufacturerId` для всех последующих запросов.

### Карточка товара: имя, рейтинг, распределение оценок, наличие

```
GET /api/goods-service/goods/info?Article=N90954802&ManufacturerId=657
```
```json
{"article":"N90954802","name":"Болт","categoryId":4558,"isFavorite":false,
 "manufacturer":{"id":657,"name":"VAG","logoUrl":"..."},
 "rating":{"average":4.9107,"quantity":56,"ratings":[54,1,0,0,1]},
 "imageUrls":["..."],"inStock":4,"allReviews":false,"items":[]}
```

`ratings` — гистограмма от пяти звёзд к одной.

### Минимальная цена и срок

```
GET /api/goods-service/goods/price?Article=N90954802&ManufacturerId=657
```
```json
{"minimalPrice":317.00,"minimalDeliveryDays":0}
```

### Отзывы, включая ИИ-выжимку

```
GET /api/goods-service/feedback/messages?Article=N90954802&ManufacturerId=657&PageNumber=1&MaxResultCount=2
```
```json
{"summary":{"name":"Нейросеть YandexGPT",
   "pros":["Как оригинал.","Отличное качество.","Подходят как родные."],
   "cons":["Изогнулся при установке."],"likes":{"isOwn":false,"count":0}},
 "sorting":[{"name":"Сначала интересные","id":1},{"name":"Сначала недавние","id":0},
            {"name":"Сначала с фотографиями","id":4},{"name":"Сначала положительные","id":2},
            {"name":"Сначала отрицательные","id":3}],
 "totalCount":35,
 "items":[{"content":"хороший товар","clientName":"Юрий Л.",
           "clientLabel":"Товар куплен в Автодок","status":{"status":"Published","name":"Опубликовано"}}]}
```

Обрати внимание: `goods/info` отдаёт `rating.quantity` = 56, а `feedback/messages`
— `totalCount` = 35. Это разные величины: оценки без текста в ленту отзывов не
попадают.

`SortOrder` принимает id из массива `sorting`. `AllReviews=true` снимает фильтр
«только по этому артикулу».

### Поиск по названию (подсказки)

```
POST /api/catalog-universal-service/catalog-universal-categories/search?SearchText=болт
Content-Type: application/json
{}
```
```json
{"items":[{"title":"БОЛТМАСТЕР","subtitle":"Производитель","routeUrl":"/man/9571"},
          {"title":"Болты","subtitle":"Инструменты и техника","routeUrl":"/catalogs/universal/goods/bolty-408"}]}
```

Это подсказка, а не выдача: возвращает производителей и категории. `CategoryId`
берётся из хвоста `routeUrl` (`bolty-408` → 408).

### Товары внутри категории

```
POST /api/catalog-universal-service/catalog-universal-goods/find-goods?CategoryId=408&PageNumber=1
{}
```
```json
{"totalCount":183,"sorting":[{"name":"Сначала популярные","id":1},{"name":"Сначала дешевле","id":2},
  {"name":"Сначала дороже","id":3},{"name":"По рейтингу","id":4},{"name":"По количеству оценок","id":5}],
 "items":[{"article":"kr013511020","name":"KRANZ Болты мебельные DIN 603, 8х30, короб",
           "manufacturer":{"id":8341,"name":"KRANZ"},"price":252,"quantity":7,
           "rating":{"average":0,"quantity":0},"isFavorite":false,"properties":[...]}]}
```

**Важно:** `find-goods` только с `SearchText`, без `CategoryId`, возвращает
`totalCount: 0`. Полнотекстового поиска по товарам в этом эндпоинте нет —
сначала подсказка, потом категория.

### Гараж

```
GET /api/garage-service/garage/cars          → {"cars":[{...}],"totalActiveRequestsCount":0}
GET /api/garage-service/garage/top-car       → {"car":{...}}  основная машина
GET /api/garage-service/garage/{carId}/products-lite
PUT /api/garage-service/garage/main-car/{carId}
```

Машина приходит так (поля, на которые можно опираться):

```json
{"id":0,"brand":"SKODA","brandId":575,"model":"OCTAVIA III лифтбек (5E3)","modelId":11195,
 "modificationId":58759,"engine":"1.8 TSI","year":2017,"vin":"...","odometer":0,
 "fullName":"SKODA OCTAVIA III лифтбек (5E3)","clientCode":"...","activeRequestsCount":0}
```

Внимание на две разные величины: у машины есть `id` (запись в гараже) и
`modificationId` (модификация в каталоге). В ответе `products-lite` поле
`carId` у товаров содержит именно **modificationId**, а не id записи гаража.

### Что требует токена

```
GET /api/price-service/price-list/originals?Article=N90954802&ManufacturerId=657
→ 401, пустое тело
```

Предложения продавцов, сроки доставки, аналоги, корзина, избранное, заказы и
профиль — всё за авторизацией. Без токена доступны: поиск по артикулу, карточка,
рейтинг, отзывы, минимальная цена, каталог и категории.

### Легаси-хост

`webapi.autodoc.ru` ещё жив и отвечает без авторизации:

```
GET https://webapi.autodoc.ru/api/manufacturers/n90954802?showAll=true
→ [{"id":657,"manufacturerName":"VAG","partName":"Болт","artNumber":"N90954802"}]

GET https://webapi.autodoc.ru/api/spareparts/657/N90954802/prices
→ {"partNumber":"N90954802","minimalPrice":0.0,"inventoryItems":[],"analogs":[],
   "fotoUrls":[...],"mark":{"avgMark":0.0,"cntMark":0}}
```

Второй отдаёт нули и пустые списки — склады без выбранного региона не считаются.
Для новой работы использовать `web.autodoc.ru`.

## Полный индекс эндпоинтов

214 вызовов, извлечены из бандла. Метод и имена query-параметров — из кода;
тела POST/PUT не восстанавливались, их нужно смотреть по месту. `${...}` —
позиционный сегмент пути. `REQUEST` — вызов через `HttpClient.request()`
(обычно `DELETE` с телом).

### `balance-service` — Баланс и платежи

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `balance/balance` | — |
| `POST` | `balance/confirm-return` | — |
| `GET` | `balance/last-operation` | `PaymentSystemId` |
| `GET` | `balance/operations` | `BeginDate` `EndDate` |
| `DELETE` | `balance/return` | `ReturnRequestId` |
| `POST` | `balance/return` | — |
| `POST` | `payment/certificate` | — |
| `POST` | `payment/payment` | — |
| `GET` | `payment/systems` | — |

### `banner-service` — Баннеры

| Метод | Путь | Query-параметры |
|---|---|---|
| `POST` | `banners/click` | — |
| `POST` | `banners/items` | — |
| `POST` | `banners/view` | — |

### `basket-service` — Корзина

| Метод | Путь | Query-параметры |
|---|---|---|
| `POST` | `basket/apply-bonus` | — |
| `POST` | `basket/apply-promocode` | — |
| `GET` | `basket/count` | — |
| `GET` | `basket/items` | — |
| `POST` | `basket/items` | — |
| `PUT` | `basket/items` | — |
| `REQUEST` | `basket/items` | — |
| `POST` | `basket/order` | — |

### `catalog-maintenance-service` — Регламент ТО

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `catalog-maintenance/items/${e}` | — |
| `GET` | `catalog-maintenance/kits/${e}` | — |
| `GET` | `catalog-maintenance/liquids/${e}` | — |

### `catalog-original-service` — Оригинальные каталоги (по VIN/модели)

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `catalog-original/brand-search-options/${t}` | — |
| `GET` | `catalog-original/brands` | — |
| `GET` | `catalog-original/car-info` | `catalogCode` `ssd` |
| `GET` | `catalog-original/categories` | `catalogCode` `ssd` |
| `GET` | `catalog-original/category-nodes/${t}` | `catalogCode` `ssd` |
| `GET` | `catalog-original/compatible-modifications/${t}` | `article` |
| `GET` | `catalog-original/goods-compatibility` | `catalogCode` `article` `ssd` |
| `GET` | `catalog-original/node-goods` | `catalogCode` `ssd` `nodeId` `quickGroupId` |
| `GET` | `catalog-original/quick-group-nodes/${t}` | `catalogCode` `ssd` `all` |
| `GET` | `catalog-original/quick-groups` | `catalogCode` `ssd` |
| `GET` | `catalog-original/vin-modifications` | `identifier` |
| `GET` | `catalog-original/wizard-items` | `catalogCode` `ssd` |
| `GET` | `catalog-original/wizard-modifications` | `catalogCode` `ssd` |

### `catalog-service` — Справочник автомобилей

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `cars/brand` | `vin` |
| `GET` | `cars/brands` | `MaxResultCount` |
| `GET` | `cars/models` | `BrandId` `MaxResultCount` |
| `GET` | `cars/modifications` | `ModelId` |
| `GET` | `cars/seo-info` | `BrandName` `Model` |

### `catalog-universal-service` — Универсальный каталог (поиск по названию)

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `catalog-universal-categories/${t}/manufacturer-categories` | — |
| `GET` | `catalog-universal-categories/categories` | `Levels` |
| `POST` | `catalog-universal-categories/search` | `SearchText` |
| `GET` | `catalog-universal-goods/compatibility/${t}` | — |
| `POST` | `catalog-universal-goods/fetch-goods-count` | — |
| `POST` | `catalog-universal-goods/filters` | `CategoryId` `IsMain` |
| `GET` | `catalog-universal-presets/items` | `carId` `categoryId` |

### `chat-service` — Чат-бот

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `chat-bot/available-answers` | `Token` `Message` |
| `GET` | `chat-bot/dialog` | `token` |
| `POST` | `chat-bot/send-message` | — |
| `POST` | `chat-bot/session` | — |

### `client-service` — Профиль клиента

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `bonuses/bonus` | `beginDate` `endDate` `loadHistory` |
| `GET` | `certificates/cards` | — |
| `GET` | `certificates/certificates` | — |
| `POST` | `certificates/give-certificate` | — |
| `GET` | `certificates/images` | — |
| `GET` | `certificates/sms-code` | `partNumber` `price` `isVirtual` |
| `POST` | `certificates/sms-code` | — |
| `GET` | `discounts/discount` | — |
| `GET` | `discounts/discount-levels` | `showAll` |
| `GET` | `edo/chestny-znak/groups` | — |
| `POST` | `edo/chestny-znak/invite` | — |
| `DELETE` | `edo/chestny-znak/settings` | — |
| `POST` | `edo/invite` | — |
| `DELETE` | `edo/settings` | — |
| `GET` | `edo/status` | — |
| `GET` | `feedback/sections` | — |
| `GET` | `firebase/custom-token` | — |
| `GET` | `mailing/unsubscribe` | `email` `token` |
| `PUT` | `notification-settings/alerts` | `isActive` |
| `PUT` | `notification-settings/email` | — |
| `GET` | `notification-settings/items` | — |
| `PUT` | `notification-settings/sms` | — |
| `GET` | `notifications/items` | `PageNumber` `MaxResultCount` |
| `DELETE` | `profile/account` | — |
| `GET` | `profile/account-summary` | — |
| `GET` | `profile/balance` | — |
| `GET` | `profile/cars` | — |
| `PUT` | `profile/email` | — |
| `PUT` | `profile/email-confirm` | — |
| `GET` | `profile/favorites-count` | — |
| `GET` | `profile/legal-information` | `LegalStatus` `ShopId` |
| `PUT` | `profile/password` | — |
| `GET` | `profile/personal-message` | — |
| `PUT` | `profile/phone` | — |
| `PUT` | `profile/phone-confirm` | — |
| `GET` | `profile/related-profiles` | — |
| `PUT` | `registration/${r}/shop` | — |
| `POST` | `registration/activate` | `code` |

### `company-service` — Магазины и новости

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `news/item` | `Link` |
| `GET` | `news/items` | `PageNumber` `MaxResultCount` |
| `GET` | `shops/${t}/shop` | — |
| `GET` | `shops/items` | — |
| `POST` | `shops/review` | — |

### `delivery-service` — Доставка

| Метод | Путь | Query-параметры |
|---|---|---|
| `DELETE` | `deliveries/${t}/address` | — |
| `DELETE` | `deliveries/${t}/contact` | — |
| `GET` | `deliveries/${t}/courier-photo` | — |
| `POST` | `deliveries/address` | `isManual` |
| `GET` | `deliveries/address-restrictions` | — |
| `GET` | `deliveries/addresses` | — |
| `GET` | `deliveries/barcode` | — |
| `POST` | `deliveries/contact` | — |
| `GET` | `deliveries/contacts` | — |
| `GET` | `deliveries/courier/${t}` | — |
| `POST` | `deliveries/create` | — |
| `GET` | `deliveries/deliveries` | — |
| `GET` | `deliveries/delivery-conditions` | — |
| `GET` | `deliveries/delivery-items/${t}` | `deliveryType` |
| `DELETE` | `deliveries/delivery/${t}` | `deliveryType` |
| `GET` | `deliveries/delivery/${t}` | `deliveryType` |
| `GET` | `deliveries/times` | `deliveryType` |
| `POST` | `deliveries/verify` | `deliveryType` |

### `favorite-service` — Избранное

| Метод | Путь | Query-параметры |
|---|---|---|
| `PUT` | `favorites/${t}/favorite` | — |
| `DELETE` | `favorites/${t}/list` | — |
| `POST` | `favorites/copy-list` | `publicToken` |
| `POST` | `favorites/favorite` | `ListId` `NotifyByExistence` `Article` `ManufacturerId` |
| `GET` | `favorites/favorites` | `Id` `IsGarage` |
| `GET` | `favorites/goods-lists` | `Article` `ManufacturerId` |
| `PUT` | `favorites/goods-lists` | — |
| `POST` | `favorites/list` | — |
| `PUT` | `favorites/list` | — |
| `GET` | `favorites/lists` | — |
| `POST` | `favorites/load-favorites` | — |
| `GET` | `favorites/public-list` | `publicToken` |
| `POST` | `favorites/search` | `searchText` |
| `GET` | `favorites/top` | — |
| `GET` | `favorites/wallpapers` | — |

### `garage-service` — Гараж

| Метод | Путь | Query-параметры |
|---|---|---|
| `DELETE` | `garage/${t}/car` | — |
| `PUT` | `garage/${t}/car` | — |
| `GET` | `garage/${t}/products` | — |
| `GET` | `garage/${t}/products-lite` | — |
| `GET` | `garage/brands` | `yearFrom` |
| `POST` | `garage/car` | — |
| `GET` | `garage/car-parameters` | `input` |
| `GET` | `garage/cars` | — |
| `PUT` | `garage/main-car/${t}` | — |
| `GET` | `garage/models/${t}` | `yearFrom` |
| `GET` | `garage/modifications/${t}` | `yearFrom` |
| `POST` | `garage/order-cars` | — |
| `GET` | `garage/top-car` | — |
| `GET` | `garage/top-goods` | `isMain` |

### `goods-service` — Товар: карточка, рейтинг, отзывы

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `compatibility/brands` | `Article` `ManufacturerId` |
| `GET` | `compatibility/model-attributes` | `BrandKey` `ModelKey` `ModelId` `Article` `ManufacturerId` |
| `GET` | `compatibility/vehicle-schemes` | `CatalogCode` `Ssd` `Article` |
| `GET` | `feedback/image-sizes` | — |
| `DELETE` | `feedback/images` | `Ids` |
| `PUT` | `feedback/images-position` | — |
| `PUT` | `feedback/like` | — |
| `DELETE` | `feedback/message` | `Id` `Article` `ManufacturerId` |
| `GET` | `feedback/message` | `ImageSize` `Article` `ManufacturerId` |
| `POST` | `feedback/message` | — |
| `POST` | `feedback/message-comment` | — |
| `GET` | `feedback/messages` | `Article` `ManufacturerId` `SortOrder` `PageNumber` `AllReviews` `MaxResultCount` |
| `PUT` | `feedback/summary-error` | — |
| `GET` | `goods/info` | `Article` `ManufacturerId` |
| `GET` | `goods/price` | `Article` `ManufacturerId` |
| `GET` | `manufacturers/${t}/info` | — |
| `GET` | `manufacturers/groups` | — |
| `GET` | `my-feedback/comments` | `PageNumber` `MaxResultCount` |
| `GET` | `my-feedback/my-messages` | `SortOrder` `PageNumber` `MaxResultCount` |
| `GET` | `my-feedback/waiting-goods` | `PageNumber` `MaxResultCount` |
| `GET` | `my-feedback/waiting-goods-count` | — |

### `logbook-service` — Бортжурнал

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `logbook/categories` | — |
| `GET` | `logbook/image/${t}` | — |
| `DELETE` | `logbook/images` | `imageIds` |
| `DELETE` | `logbook/item/${t}` | — |
| `GET` | `logbook/items` | `CarId` |
| `POST` | `logbook/odometer-item` | — |
| `GET` | `logbook/odometer-items/${t}` | — |

### `marketing-service` — Метаданные страниц

| Метод | Путь | Query-параметры |
|---|---|---|
| `POST` | `meta/metadata` | — |

### `order-service` — Заказы

| Метод | Путь | Query-параметры |
|---|---|---|
| `PUT` | `orders/barcode` | — |
| `PUT` | `orders/cancel/${e}` | `orderType` |
| `GET` | `orders/count` | — |
| `GET` | `orders/details/${e}` | — |
| `GET` | `orders/grouped-history/${e}` | — |
| `GET` | `orders/invoice/${e}` | — |
| `GET` | `orders/items` | `BeginDate` `EndDate` `Statuses` |
| `GET` | `orders/ready` | — |
| `GET` | `orders/statuses` | — |

### `price-service` — Цены и поиск по артикулу

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `price-list/access-levels` | — |
| `GET` | `price-list/analogs` | `Article` `ManufacturerId` `CrossLevel` `PriceLevel` |
| `GET` | `price-list/delivery-statistics` | `ManufacturerId` `DirectionToManufacturerId` `PartnerId` `PriceType` |
| `GET` | `price-list/goods-info` | `Article` `ManufacturerId` |
| `GET` | `price-list/liquids-volumes` | `ManufacturerId` `Article` |
| `GET` | `price-list/originals` | `Article` `ManufacturerId` `LoadAnalogs` `GoodsType` `PriceLevel` `Source` |
| `GET` | `search/manufacturers` | `article` |
| `GET` | `search/price-history` | — |

### `promo-service` — Акции и кэшбэк

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `autoclubs/clubs` | — |
| `DELETE` | `autoclubs/photo/${r}` | — |
| `GET` | `autoclubs/photo/${r}` | — |
| `POST` | `autoclubs/photo/${r}` | — |
| `GET` | `autoclubs/status` | — |
| `GET` | `cashback/status` | — |
| `DELETE` | `exclusive/nickname` | — |
| `PUT` | `exclusive/nickname` | — |
| `GET` | `exclusive/status` | — |
| `DELETE` | `frames/photo` | — |
| `GET` | `frames/photo` | — |
| `POST` | `frames/photo` | — |
| `GET` | `frames/status` | — |
| `GET` | `promo` | — |
| `GET` | `promo/details` | `promoName` |
| `POST` | `promo/products` | — |
| `GET` | `refer-friend/friends` | — |
| `GET` | `refer-friend/status` | — |

### `vin-service` — VIN-запросы

| Метод | Путь | Query-параметры |
|---|---|---|
| `GET` | `vin/check` | — |
| `GET` | `vin/goods` | `RequestId` |
| `POST` | `vin/request` | — |
| `DELETE` | `vin/request/${t}` | — |
| `GET` | `vin/requests` | `IsDefault` `DateFrom` `DateTo` `CarId` `StatusKey` |
| `GET` | `vin/statuses` | — |
| `GET` | `vin/suggestions` | `query` |
| `GET` | `vin/top-requests` | — |

<!-- всего 214 -->

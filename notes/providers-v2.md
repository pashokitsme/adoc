# providers-v2 — ссылки, поиск по машине, человеческий вывод

Рабочие заметки ветки `feat/providers-v2`. Всё, что ниже, снято живьём
2026-09-02 с реальных аккаунтов; личных данных здесь нет.

## 1. Autodoc: адреса страниц

Сайт — Angular SPA без SSR, поэтому `curl` по адресу ничего не доказывает
(любой путь отдаёт один и тот же shell с `<title>Автодок</title>`). Источник
правды — таблица маршрутов из бандла: `https://www.autodoc.ru/main-*.js` плюс
рекурсивно все `chunk-*.js` (188 файлов, ~6 МБ). Маршруты ищутся по
`grep -oE 'path:"[^"]*"'`, ссылки — по `"/man/"+` и `` `/man/${` ``.

| что | адрес | откуда известно |
|---|---|---|
| карточка товара | `/man/<manufacturerId>/part/<артикул в нижнем регистре>` | `ManRoutes`: `:manId/part/:article`; шаблон карточки строит ровно это |
| отзывы | `.../part/<артикул>/reviews` | `ManGoodsRoutes`: дети `""`, `reviews`, `compatibility` |
| применимость | `.../part/<артикул>/compatibility` | там же |
| прайс-лист (предложения) | `/price/<manufacturerId>/<артикул>` | `PriceRoutes`: `:manId/:article`; шапка поиска по артикулу ведёт сюда |
| корзина | `/cart` | `CartRoutes`, `routerLink="/cart"` — **не** `/basket`, как было в коде |
| заказы | `/my/orders` (дети `all`, `ready`, `deliveries`) | `MyRoutes` |
| гараж | `/my/garage/<carId>` | `GarageRoutes` |
| избранное / профиль | `/my/favorites`, `/my/profile` | `MyRoutes` |
| категория каталога | `/catalogs/universal/goods/<seoUrl>-<id>` | `routeUrl` из подсказки |

Канонический адрес карточки сайт приводит к нижнему регистру — делаем так же.

## 2. Autodoc: поиск с учётом гаража

Ручка та же, что и раньше: `POST /api/catalog-universal-service/catalog-universal-goods/find-goods`.
В бандле у неё 13 параметров; сайт зовёт её так (страница категории):

```
findGoods(filters, categoryId, pageNumber, sortingId,
          carParams.brandName, carParams.seriesModel, carParams.modificationId,
          searchText, IsCatalogsCar=false, name, pageSize)
```

то есть query: `CategoryId, PageNumber, SortingId, BrandName, Model,
ModificationId, SearchText, IsCatalogsCar, Name, MaxResultCount`.

Важное: **`Model` — это `modelId` числом, а не название модели**
(`seriesModel: carFilterModel().modelId?.toString()`). Замеры на категории
«Фильтры масляные» (4673), машина из гаража — SKODA OCTAVIA III, modelId 11195,
modificationId 58759:

| параметры | всего |
|---|---|
| ничего | 5517 |
| `ModificationId` один | 5517 (игнорируется) |
| `BrandName=SKODA` | 657 |
| `BrandName` + `Model=11195` | 118 |
| `BrandName` + `Model=11195` + `ModificationId=58759` | **36** |
| `Model=11195` + `ModificationId` без бренда | 5517 |
| `IsCatalogsCar=true` | 0 (другой источник данных, не наш) |
| `Model=«OCTAVIA III лифтбек (5E3)»` (имя вместо id) | 657 — имя не матчится |

Вывод: нужны все три параметра и `Model` именно числом. Отсюда `Car.ref` у
autodoc теперь несёт `brandName` и `modelId` рядом с `carId`/`modificationId`.

Ещё две находки по этой же ручке:
- `PageNumber` **нумеруется с нуля** (`pageNumber||0`), а провайдер слал
  `ctx.page`, то есть `--page 1` показывал вторую страницу.
- `MaxResultCount` — размер страницы; раньше мы просили страницу целиком и
  резали её на клиенте.

### Ранжирование категорий

`search` берёт первую категорию из подсказки, и на «тормозные колодки» первой
приходит «Станки для заклепки тормозных колодок» — это и есть «мусор в выдаче».
Теперь категория выбирается по совпадению слов: доля слов заголовка, которые
нашлись в запросе (слова сравниваются по общему префиксу ≥ 4 символов, чтобы
«свеча»/«свечи» и «колодки»/«колодок» считались одним словом).

| запрос | было первым | стало первым |
|---|---|---|
| тормозные колодки | Станки для заклепки тормозных колодок | Колодки тормозные |
| масло моторное 5w30 | Масло моторное | Масло моторное |
| фильтр масляный | Фильтры масляные | Фильтры масляные |

## 3. Armtek: адреса страниц

Тоже Angular SPA (`main.1079.js` + 335 чанков), но `curl` без `--compressed`
получает бинарный br-поток, а обычный `curl` — заглушку в 1631 байт; маршруты
снова берутся из бандла.

| что | адрес |
|---|---|
| карточка товара | `/product/<ARTICLE_ALIAS>`, а без алиаса — `/product/<ARTID>` |
| уценённая позиция | `/product/markdown/<alias>/<charg>` |
| корзина | `/basket` |
| заказы | `/profile/orders`, карточка — `/profile/orders/card?orderId=<VBELN>` (или `?orderHash=<GUID>`) |
| гараж / профиль / избранное | `/profile/garage`, `/profile/info`, `/profile/favorite` |
| поиск | `/search?text=<запрос>` |
| категория | `/category/<alias>` |

Отдельной страницы отзывов у armtek нет: лента живёт на карточке товара и
листается скроллом (`scrollToReviews()`), якоря в адресе нет. Поэтому
`Reviews.url` у armtek — адрес карточки.

## 4. Armtek: поиск с учётом гаража

`POST search-microservice/v1/search` (свободный текст) машину **не принимает**:
`linkingTargetId`/`linkingTargetType` он отбивает («Это поле не ожидалось»), а
`indexedAutoId` принимает и игнорирует — это идентификатор из ленивой
VIN-идентификации laximo, и на VIN нашей машины `laximo-microservice/v1/unisearch/auto/identify`
отдаёт пустой список.

Машину принимает **`POST search-microservice/v1/search/by-category`**:

```json
{"query":"<alias категории>","page":1,"typeView":"list",
 "userInfo":{"VKORG":"4000","VSTELS_LIST":["ME86"]},
 "linkingTargetId":58759,"linkingTargetType":"P"}
```

Alias категории даёт `GET search-microservice/v1/autocomplete/search?type=3&query=<текст>`
(поле `category[].ALIAS`). Замер на «фильтр масляный» → `filtry-maslyanye-8963`:

| запрос | всего |
|---|---|
| свободный поиск, без машины | 997 |
| `by-category` без машины | 53859 |
| `by-category` + `linkingTargetId=58759` (1.8 TSI) | **392** |
| `by-category` + `linkingTargetId=58750` (1.4 TSI) | 1029 |

Ответ у `by-category` той же формы, что у `search` (`articlesData` с
`SUGGESTIONS`), так что маппер переиспользуется целиком.

**`linkingTargetId` — это идентификатор модификации TecDoc, и он совпадает с
`modificationId` из гаража autodoc.** Проверено: `substitutes-microservice/v1/substitutes/get-vehicle-ids-and-car-info?manuId=106&modId=11195&linkingTargetType=P`
содержит `carId: 58759`, а `get-model-series` для SKODA отдаёт `modelId: 11195` —
те же числа, что у autodoc. Оба сайта сидят на TecDoc.

Ограничение: гараж этого аккаунта на armtek **пуст**, поэтому форма
`transportList` живьём не проверена и TecDoc-идентификатора в ней, скорее
всего, нет. Провайдер поэтому принимает в `--car` ref с любым из полей
`linkingTargetId` / `modificationId` / `carId`, а если числа нет — честно
предупреждает и ищет без машины.

## 5. Armtek: заказы

`GET order-microservice/v1/order/report` — список; `order-microservice/v1/order/get-info`
— карточка. У аккаунта заказов нет (`{"KEY":…,"PAGE":1,"ORDER":[]}`), поэтому
форма строки заказа взята из бандла (чанк `chunk-FZVGACXA.js`): `VBELN`,
`GUID`, `date`/`ORDER_DATE`/`CREDT`, `ORDER_STATUS`, `NETWR`, `ITEMS[]` с
`PIN`, `BRAND`, `NAME`/`ARTICLE_NAME`, `KWMENG`, `PRICE`, `ARTICLE_ALIAS`.

Причуда валидатора: `dateFrom` и `dateTo` работают **по отдельности**, но
любая их пара отбивается «dateFrom: Значение не является правильной датой».
Поэтому провайдер по умолчанию не шлёт дат вовсе.

## 6. Autodoc: заказы

`GET /api/order-service/orders/items?BeginDate&EndDate&Statuses` отдаёт не
заказы, а **позиции** заказов: у каждой свои `id`, `status`, `total`,
`createDate` и один товар в `goods`. Умолчание — последний месяц.

**Номер заказа — поле `number`**, и позиции с одним номером — один заказ. Это
не догадка: `GET /api/order-service/orders/ready` отдаёт
`{"items":[{"number":4,"goods":[…]}]}` — сайт группирует ровно по `number` и
не разделяет позиции разных `orderType` (в живом заказе №4 под одним номером
лежат три позиции `orderType: 1` и три `orderType: 2`).

Проверены и отвергнуты: `orders/grouped-history/<id>` и `orders/details/<id>`
— это история статусов **одной позиции**, а не состав заказа;
`orders/info/<id>` отвечает 404. Страницы отдельного заказа у сайта тоже нет
(в маршрутах только `/my/orders/{all,ready,deliveries}`), поэтому `Order.url`
— адрес списка.

Статус у позиций одного заказа разный, а в контракте он один: берём самый
ранний по `groupId` (заказ не сделан, пока не доехала самая медленная
позиция), список всех — в `extra.statuses`, разбор по позициям с их `id`,
`orderType` и статусом — в `extra.positions`. Дата заказа — самая ранняя
живая `createDate` (у части позиций она приходит пустышкой `0001-01-01`).

Живьём: 12 позиций за месяц свернулись в 5 заказов; заказ №4 — 6 позиций на
14 688 ₽.

## 7. Что изменилось в выводе

Всё ниже снято живьём на реальных аккаунтах.

### Ссылки

Их не было нигде, кроме `Offer.url` (и та вела на прайс-лист, а не на карточку)
и `Basket.url` (та вообще вела на `/basket`, которого у сайта нет — правильный
адрес `/cart`). Стало: колонка `ССЫЛКА` в `search`, `brands`, `offers`,
`analogs`, `basket` и в своих командах autodoc (`goods`, `garage parts`,
`favorites`), адрес страницы отзывов под гистограммой в `reviews`, адрес
карточки последней строкой в `info`, адрес корзины под итогом.

Чтобы колонка не разрасталась, повторный адрес не печатается: у `offers`
десяток строк одной детали ведут на одну карточку, и она названа один раз.

```
# было
1  VAG  Болт  407 ₽  100 шт  3 дня  Дилер · Склад дилера  4.9★ (56)
# стало
1  VAG  Болт  407 ₽  100 шт  3 дня  Дилер · Склад дилера  4.9★ (56)  https://www.autodoc.ru/price/657/n90954802
```

### Поиск

```
# было: adoc-autodoc search "тормозные колодки"
первая категория подсказки — «Станки для заклепки тормозных колодок»
# стало
Колодки тормозные; с --car — 188 позиций под SKODA OCTAVIA III вместо 27 тысяч
```

`--page 1` показывал вторую страницу выдачи: `PageNumber` у `find-goods`
нумеруется с нуля, а провайдер слал `ctx.page`. Исправлено.

### Свои команды autodoc

| команда | было | стало |
|---|---|---|
| `info` | своя команда, сырой JSON плюс самодельная карточка | контрактная `info`, `renderInfo` из SDK |
| `analogs` | сырой JSON `price-list/analogs` | контрактная `analogs`, таблица предложений |
| `orders` | сырой JSON | контрактная `orders`: один заказ на строку (группировка по `number`), дата, статус, сумма, позиции и ссылки |
| `prices` | сырой JSON | таблица предложений, сырой ответ остался в `--json` |
| `favorites` | сырой JSON | таблица списков или таблица товаров со ссылками |
| `profile` | сырой JSON | `баланс / бонусы / сертификаты` полями |
| `goods` | таблица без ссылок | плюс название категории в шапке и колонка ссылок |
| `garage parts` | таблица без ссылок | плюс колонка ссылок |

### Найденные по дороге ошибки

- **Корзина autodoc теряла артикул, бренд и продавца.** Позиция корзины
  отдаёт их вложенными в `priceItem`, а маппер читал плоские поля, которых в
  живом ответе нет: в таблице были пустые колонки. Записанная фикстура тоже
  была не той формы — обновлена живым ответом.
- **`Basket.url` вёл на `/basket`**, которого у autodoc нет; правильный адрес
  `/cart`.
- **`--page` у поиска autodoc был сдвинут на страницу** (см. выше).
- **Дата у части заказов autodoc — `0001-01-01`**: пустое значение SAP;
  теперь отдаётся пустой строкой и рисуется прочерком.

## 8. Живые проверки

Autodoc: `whoami`, `search` (с `--car` и без), `brands`, `offers`, `analogs`,
`info`, `reviews`, `orders`, `garage export`, `garage`, `garage parts`,
`goods`, `prices`, `favorites`, `profile`, `get`/`post`, круговой проход по
корзине `add → basket → set --qty 2 → rm`.

Armtek: `whoami`, `search` (с `--car` и без, и с ref без идентификатора —
предупреждение), `brands`, `offers`, `analogs`, `info`, `reviews`, `orders`
(пусто), `garage export` (пусто), `vstel`, `raw`, круговой проход по корзине
`add → basket → set --qty 2 → rm`.

**Обе корзины на конец работы пусты — ровно как были до начала.** Записей на
сайты: по одному POST, одному PUT и одному DELETE на каждую корзину. Заказы,
оформление, оплата, профиль, гараж и избранное не трогались.

## 9. Открытые вопросы

- Гараж armtek пуст, поэтому форма `transportList` и наличие в ней
  TecDoc-идентификатора не проверены. Пока `search --car` у armtek работает
  только с ref, где есть число (`linkingTargetId`/`modificationId`/`carId`);
  ref из его собственного `garage export` такого числа, скорее всего, не
  несёт. Если оно там не появится — надо будет доставать его по
  марке/модели/модификации через `substitutes-microservice`.
- Заказов на armtek нет, форма строки взята из бандла: маппер написан мягко,
  но живьём не проверен.
- Статус заказа у autodoc — производная величина: сайт хранит статус на
  позиции, и «самый ранний по `groupId`» — наше решение, а не поле API.

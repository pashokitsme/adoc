#!/usr/bin/env bun
// adoc — командная строка для неофициального API autodoc.ru.
//
// Usage:
//   adoc <команда> [аргументы] [--json]
//
// Поиск и товар (без авторизации):
//   search <текст>              Подсказка по названию: производители и категории
//   goods <categoryId>          Товары внутри категории (id даёт `search`)
//   part <артикул>              Кто выпускает этот артикул, с рейтингом и ценой
//   info <артикул> [brandId]    Карточка: рейтинг, гистограмма оценок, наличие
//   reviews <артикул> [brandId] Отзывы и выжимка нейросети
//
// Требует авторизации:
//   prices <артикул> [brandId]  Предложения продавцов: цена, срок, количество
//   analogs <артикул> [brandId] Аналоги
//   basket                      Корзина
//   favorites [listId]          Избранное; без аргумента — списки
//   orders                      Заказы
//   profile                     Сводка по аккаунту
//   garage                      Гараж: список машин, ★ отмечает основную
//   garage parts <carId>        Подборка запчастей под конкретную машину
//   garage main <carId>         Сделать машину основной
//
// Аккаунт:
//   login                       Авторизоваться (см. ниже)
//   logout                      Забыть токен
//   whoami                      Показать, есть ли живой токен
//
// Прочее:
//   get <путь> [k=v ...]        Произвольный GET к web.autodoc.ru
//   post <путь> [k=v ...]       Произвольный POST (тело пустое)
//
// Опции:
//   --json                      Сырой JSON вместо таблиц — для jq
//   --limit <n>                 Сколько строк показывать (по умолчанию 10)
//   --page <n>                  Страница выдачи
//   --sort <id>                 Порядок сортировки; id печатает сама команда
//   --auth                      Слать токен и в `get`/`post`
//   -h, --help                  Эта справка
//
// brandId необязателен: если его не дать, тул сам найдёт производителя по
// артикулу и возьмёт единственного. Когда их несколько — покажет список и
// попросит уточнить, потому что цены и отзывы у них разные.
//
// Авторизация. `adoc login` спрашивает телефон или email и пароль прямо в терминале;
// пароль вводится без эха, никуда не записывается и уходит единственным
// запросом на login.autodoc.ru (grant_type=password). Аргументом его передать
// нельзя намеренно — иначе он осел бы в истории шелла и в `ps`.
//
// `adoc login --paste` — запасной путь без пароля: в консоли браузера на
// autodoc.ru с открытой сессией `copy(JSON.stringify(sessionStorage))`, буфер
// вставляется в приглашение. Тул вытащит оттуда access и refresh токены.
//
// Токен лежит в $XDG_CONFIG_HOME/adoc/token.json с правами 600 и обновляется
// сам по refresh_token. `adoc logout` удаляет файл.
//
// Карта всех 214 эндпоинтов, соглашения по параметрам и что именно требует
// авторизации — в docs/autodoc-api.md.

import * as api from "./providers/autodoc/api.ts"
import { ApiError } from "./providers/autodoc/api.ts"
import * as auth from "./providers/autodoc/auth.ts"
import { bar, bold, cyan, dim, days, fields, fold, green, heading, maskEmail, maskPhone, money, red, rule, stars, table, yellow } from "./sdk/render.ts"

// --- разбор аргументов ----------------------------------------------------

const argv = process.argv.slice(2)
const flags: Record<string, string | true> = {}
const args: string[] = []
for (let i = 0; i < argv.length; i++) {
	const a = argv[i]!
	if (a === "-h" || a === "--help") flags.help = true
	else if (a.startsWith("--")) {
		const [k, inline] = a.slice(2).split("=", 2)
		if (inline !== undefined) flags[k!] = inline
		else if (["limit", "page", "sort"].includes(k!)) flags[k!] = argv[++i] ?? ""
		else flags[k!] = true
	} else args.push(a)
}
const cmd = args.shift()
const json = flags.json === true

const out = (v: unknown) => console.log(JSON.stringify(v, null, 2))
const die: (msg: string) => never = msg => { console.error(red(msg)); process.exit(1) }

/** Числовой флаг с проверкой: без неё NaN молча уезжает в параметры запроса. */
function num(name: string, v: string | true | undefined, def: number): number {
	if (v === undefined) return def
	if (v === true) die(`--${name}: нужно значение`)
	const n = Number(v)
	if (!Number.isFinite(n) || n < 0) die(`--${name}: нужно неотрицательное число, а не «${v}»`)
	return n
}

const limit = num("limit", flags.limit, 10)
const page = num("page", flags.page, 1)
const sort = flags.sort === undefined ? undefined : num("sort", flags.sort, 0)

function usage(): void {
	const src = Bun.file(new URL("main.ts", import.meta.url)).text()
	src.then(t => {
		const body = t.split("\n").slice(1)
		const end = body.findIndex(l => !l.startsWith("//"))
		console.log(body.slice(0, end).map(l => l.replace(/^\/\/ ?/, "")).join("\n").trim())
	})
}

// --- разрешение артикул → производитель -----------------------------------

async function resolveBrand(article: string, given?: string): Promise<{ id: number; name: string; goodsName?: string }> {
	if (given && /^\d+$/.test(given)) return { id: Number(given), name: "" }
	const { items } = await api.searchArticle(article)
	if (!items.length) die(`артикул ${article} не найден`)
	if (items.length === 1) {
		const it = items[0]!
		return { id: it.manufacturer.id, name: it.manufacturer.name, goodsName: it.goodsName }
	}
	console.error(yellow(`Артикул ${article} есть у ${items.length} производителей — уточни brandId:`))
	console.error(table(items.map(i => [
		String(i.manufacturer.id), bold(i.manufacturer.name), i.goodsName ?? "",
	]), ["ID", "ПРОИЗВОДИТЕЛЬ", "НАЗВАНИЕ"]))
	process.exit(2)
}

// --- команды --------------------------------------------------------------

async function cmdSearch(text: string): Promise<void> {
	const r = await api.suggest(text)
	if (json) return out(r)
	if (!r.items?.length) { console.log(dim("ничего не найдено")); process.exit(1) }
	console.log(table(r.items.map(i => {
		const id = i.routeUrl?.match(/-(\d+)$/)?.[1] ?? ""
		return [id ? cyan(id) : dim("—"), bold(i.title), dim(i.subtitle ?? "")]
	}), ["ID", "НАЗВАНИЕ", "РАЗДЕЛ"]))
	console.log(dim(`\nID категории годится для \`adoc goods <id>\``))
}

async function cmdGoods(categoryId: string): Promise<void> {
	const r = await api.categoryGoods(Number(categoryId), { PageNumber: page, SortingId: sort })
	if (json) return out(r)
	console.log(dim(`всего ${r.totalCount}, страница ${page}`))
	if (!r.items?.length) process.exit(1)
	console.log(table(r.items.slice(0, limit).map(g => [
		cyan(g.article), bold(g.name.slice(0, 46)), dim(g.manufacturer?.name ?? ""),
		money(g.price), g.quantity ? green(`${g.quantity} шт`) : dim("нет"),
		g.rating?.quantity ? `${g.rating.average.toFixed(1)}★` : dim("—"),
	]), ["АРТИКУЛ", "НАЗВАНИЕ", "ПРОИЗВОДИТЕЛЬ", "ЦЕНА", "НАЛИЧИЕ", "РЕЙТИНГ"]))
	if (r.sorting?.length) console.log(dim(`\n--sort: ${r.sorting.map(s => `${s.id}=${s.name}`).join(", ")}`))
}

async function cmdPart(article: string): Promise<void> {
	const r = await api.searchArticle(article)
	if (json) return out(r)
	if (!r.items?.length) { console.log(dim("не найдено")); process.exit(1) }
	const rows = await Promise.all(r.items.map(async i => {
		const [info, price] = await Promise.all([
			api.goodsInfo(i.article, i.manufacturer.id).catch(() => null),
			api.goodsPrice(i.article, i.manufacturer.id).catch(() => null),
		])
		return [
			String(i.manufacturer.id), bold(i.manufacturer.name), i.goodsName ?? "",
			money(price?.minimalPrice), days(price?.minimalDeliveryDays),
			info?.rating?.quantity ? `${info.rating.average.toFixed(2)}★ (${info.rating.quantity})` : dim("—"),
			info?.inStock ? green(`${info.inStock} шт`) : dim("нет"),
		]
	}))
	console.log(table(rows, ["ID", "ПРОИЗВОДИТЕЛЬ", "НАЗВАНИЕ", "ОТ", "СРОК", "РЕЙТИНГ", "НАЛИЧИЕ"]))
}

async function cmdInfo(article: string, brand?: string): Promise<void> {
	const b = await resolveBrand(article, brand)
	const [info, price] = await Promise.all([
		api.goodsInfo(article, b.id),
		api.goodsPrice(article, b.id).catch(() => null),
	])
	if (json) return out({ info, price })
	console.log(`${bold(info.name)}  ${dim(info.article)}`)
	console.log(`${info.manufacturer.name}  ${dim(`id ${info.manufacturer.id}`)}`)
	console.log(heading("Оценки"))
	console.log(`  ${stars(info.rating?.average)}  ${bold(info.rating?.average?.toFixed(2) ?? "—")}  ${dim(`${info.rating?.quantity ?? 0} оценок`)}`)
	for (const l of bar(info.rating?.ratings)) console.log(l)
	console.log(heading("Наличие и цена"))
	console.log(`  минимальная цена  ${bold(money(price?.minimalPrice))}`)
	console.log(`  срок              ${days(price?.minimalDeliveryDays)}`)
	console.log(`  на складе         ${info.inStock ? green(`${info.inStock} шт`) : dim("нет")}`)
	if (info.categoryId) console.log(`  категория         ${cyan(String(info.categoryId))}`)
	console.log(dim(`\nhttps://www.autodoc.ru/price/${info.manufacturer.id}/${info.article}`))
}

async function cmdReviews(article: string, brand?: string): Promise<void> {
	const b = await resolveBrand(article, brand)
	const r = await api.reviews(article, b.id, { PageNumber: page, MaxResultCount: limit, SortOrder: sort })
	if (json) return out(r)
	console.log(dim(`отзывов: ${r.totalCount}`))
	if (r.summary?.pros?.length || r.summary?.cons?.length) {
		console.log(heading(`Выжимка — ${r.summary.name ?? "нейросеть"}`))
		for (const p of r.summary.pros ?? []) console.log(`  ${green("+")} ${p}`)
		for (const c of r.summary.cons ?? []) console.log(`  ${red("−")} ${c}`)
	}
	for (const it of r.items ?? []) {
		const who = [it.clientName, it.clientLabel].filter(Boolean).join(" · ")
		console.log(heading(`${it.mark ? stars(it.mark) + "  " : ""}${who || "аноним"}`) +
			(it.createdDate ? dim(`  ${it.createdDate.slice(0, 10)}`) : ""))
		if (it.pros) console.log(`  ${green("+")} ${it.pros}`)
		if (it.cons) console.log(`  ${red("−")} ${it.cons}`)
		if (it.content) console.log(fold(it.content))
	}
	if (r.sorting?.length) console.log(dim(`\n--sort: ${r.sorting.map(s => `${s.id}=${s.name}`).join(", ")}`))
}

// Построчное чтение stdin. Остаток буфера переживает вызов: пайп может
// прислать несколько строк одним куском, а закрытый поток не должен подвешивать
// процесс навсегда.
let leftover = ""
let stdinEnded = false

function readLine(prompt: string): Promise<string> {
	process.stdout.write(prompt)
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
async function readSecret(prompt: string): Promise<string> {
	if (!process.stdin.isTTY) return await readLine(prompt)
	process.stdout.write(prompt)
	process.stdin.setRawMode(true)
	process.stdin.resume()
	process.stdin.setEncoding("utf8")
	return new Promise<string>(resolve => {
		let buf = ""
		const finish = (v: string) => {
			process.stdin.off("data", onData)
			process.stdin.setRawMode(false)
			process.stdin.pause()
			process.stdout.write("\n")
			resolve(v)
		}
		const onData = (chunk: string) => {
			for (const c of chunk) {
				if (c === "\r" || c === "\n") return finish(buf)
				if (c === "\u0003") { process.stdin.setRawMode(false); process.stdout.write("\n"); process.exit(130) }
				if (c === "\u007f" || c === "\b") {
					if (buf) { buf = buf.slice(0, -1); process.stdout.write("\b \b") }
					continue
				}
				if (c < " ") continue // управляющие символы в пароль не пускаем
				buf += c
				process.stdout.write(dim("•"))
			}
		}
		process.stdin.on("data", onData)
	})
}

function whoLine(c: auth.Claims | null): string {
	const name = c?.unique_name || c?.login || c?.preferred_username
	return name ? bold(name) : dim("аккаунт без имени")
}

function accountFields(c: auth.Claims | null, t: auth.Tokens): [string, string][] {
	const left = t.expires_at - Math.floor(Date.now() / 1000)
	const scopes = typeof c?.scope === "string" ? c.scope.split(" ") : (c?.scope ?? [])
	const services = scopes.filter(x => x.endsWith("Service"))
	return [
		["email", maskEmail(c?.displayEmail || c?.email)],
		["телефон", maskPhone(c?.phone_number)],
		["город", c?.cityId ? String(c.cityId) : dim("—")],
		["токен", left > 0 ? `живёт ещё ${Math.floor(left / 60)} мин` : yellow("протух")],
		["refresh", t.refresh_token ? green("есть") : yellow("нет")],
		["доступ", services.length ? dim(`${services.length} сервисов`) : dim("—")],
		["файл", dim(auth.accountPath().replace(process.env.HOME ?? "", "~"))],
	]
}

async function cmdGarage(sub?: string, arg?: string): Promise<void> {
	if (sub === "main") {
		const id = Number(arg)
		if (!id) die("нужен id машины: `adoc garage main <carId>`")
		await api.garageSetMain(id)
		console.log(green(`основной автомобиль теперь ${id}`))
		return
	}

	if (sub === "parts") {
		const id = Number(arg)
		if (!id) die("нужен id машины: `adoc garage parts <carId>`")
		const r = await api.garageProducts(id)
		if (json) return out(r)
		if (r.modification) console.log(dim(r.modification))
		const goods = r.goods ?? []
		if (!goods.length) { console.log(dim("подборки для этой машины нет")); process.exit(1) }
		console.log(table(goods.map(g => {
			const best = (g.items ?? []).reduce<{ price?: number; deliveryDays?: number } | null>(
				(acc, it) => (acc === null || (it.price ?? Infinity) < (acc.price ?? Infinity) ? it : acc), null)
			return [
				cyan(g.article), bold(g.name.slice(0, 40)), dim(g.manufacturer?.name ?? ""),
				money(best?.price), days(best?.deliveryDays), dim(g.groupName ?? ""),
			]
		}), ["АРТИКУЛ", "НАЗВАНИЕ", "ПРОИЗВОДИТЕЛЬ", "ОТ", "СРОК", "ГРУППА"]))
		return
	}

	if (sub) die(`неизвестная подкоманда гаража: ${sub}`)

	const [list, top] = await Promise.all([api.garageCars(), api.garageTopCar().catch(() => null)])
	if (json) return out({ ...list, mainCarId: top?.car?.id ?? null })
	const cars = list.cars ?? []
	if (!cars.length) { console.log(dim("гараж пуст")); process.exit(1) }
	const mainId = top?.car?.id
	console.log(table(cars.map(c => [
		c.id === mainId ? yellow("★") : " ",
		cyan(String(c.id)),
		bold([c.brand, c.model].filter(Boolean).join(" ")),
		c.engine ?? dim("—"),
		c.year ? String(c.year) : dim("—"),
		c.vin ?? dim("—"),
		c.odometer ? `${c.odometer.toLocaleString("ru-RU")} км` : dim("—"),
	]), [" ", "ID", "АВТОМОБИЛЬ", "ДВИГАТЕЛЬ", "ГОД", "VIN", "ПРОБЕГ"]))
	console.log(dim("\n★ — основная машина; `adoc garage parts <id>` — подборка под неё"))
}

async function cmdLogin(): Promise<void> {
	if (flags.paste === true) return cmdLoginPaste()

	const already = await auth.loadTokens()
	console.log(bold("\nАвторизация на autodoc.ru"))
	if (already) {
		console.log(dim(`Сейчас сохранён вход: ${whoLine(auth.decodeClaims(already.access_token))}. Будет заменён.`))
	}
	console.log()

	const username = (await readLine("Логин, телефон или email > ")).trim()
	if (!username) die("Логин не может быть пустым")
	const password = await readSecret("Пароль > ")
	if (!password) die("Пароль не может быть пустым")

	const spin = process.stdout.isTTY
	if (spin) process.stdout.write(dim("Проверяю…"))
	let tokens: auth.Tokens
	try {
		tokens = await auth.passwordGrant(username, password)
	} catch (e) {
		if (spin) process.stdout.write("\r" + " ".repeat(24) + "\r")
		const m = e instanceof Error ? e.message : String(e)
		if (m.includes("invalid_grant")) die("Логин или пароль не подошли")
		die(m)
	}
	if (spin) process.stdout.write("\r" + " ".repeat(24) + "\r")

	await auth.saveTokens(tokens)

	const claims = auth.decodeClaims(tokens.access_token)
	console.log(`${green("✓")} ${whoLine(claims)}`)
	console.log(fields(accountFields(claims, tokens), "  "))
	if (!tokens.refresh_token) {
		console.log(yellow("\nrefresh-токена нет — вход придётся повторить, когда access протухнет"))
	}
	console.log()
}

async function cmdLoginPaste(): Promise<void> {
	console.log(bold("\n  Вход по сохранённой сессии браузера\n"))
	console.log("  1. Войди на " + cyan("https://www.autodoc.ru") + " как обычно")
	console.log("  2. DevTools → Console → " + cyan("copy(JSON.stringify(sessionStorage))"))
	console.log("  3. Вставь буфер сюда\n")

	for (let attempt = 1; attempt <= 3; attempt++) {
		const parsed = auth.parsePasted(await readLine("  > "))
		if (parsed && "diag" in parsed) {
			console.log(yellow("\n  это диагностика ошибки SPA, а не токены"))
			console.log(dim("  нужен вывод copy(JSON.stringify(sessionStorage)) со страницы, где ты уже вошёл\n"))
			continue
		}
		if (!parsed) {
			console.log(red("  здесь нет access_token — нужен дамп sessionStorage\n"))
			continue
		}
		await auth.saveTokens(parsed.tokens)
		const claims = auth.decodeClaims(parsed.tokens.access_token)
		console.log(`\n  ${green("✓")} ${whoLine(claims)}`)
		console.log(fields(accountFields(claims, parsed.tokens), "    "))
		console.log()
		return
	}
	die("  три неудачные попытки")
}

async function cmdWhoami(): Promise<void> {
	const t = await auth.loadTokens()
	if (!t) {
		console.log(dim("не авторизован — `adoc login`"))
		process.exit(1)
	}
	const c = auth.decodeClaims(t.access_token)
	if (json) return out({ claims: c, expires_at: t.expires_at, has_refresh: !!t.refresh_token })
	console.log(`\n  ${whoLine(c)}`)
	console.log("  " + rule())
	console.log(fields(accountFields(c, t), "  "))
	console.log()
}

const kv = (rest: string[]): Record<string, string> =>
	Object.fromEntries(rest.filter(a => a.includes("=")).map(a => {
		const i = a.indexOf("=")
		return [a.slice(0, i), a.slice(i + 1)]
	}))

// --- диспетчер ------------------------------------------------------------

if (!cmd || flags.help) { usage() }
else {
	try {
		switch (cmd) {
			case "search":    await cmdSearch(args.join(" ") || die("нужен текст запроса")); break
			case "goods":     await cmdGoods(args[0] ?? die("нужен categoryId")); break
			case "part":      await cmdPart(args[0] ?? die("нужен артикул")); break
			case "info":      await cmdInfo(args[0] ?? die("нужен артикул"), args[1]); break
			case "reviews":   await cmdReviews(args[0] ?? die("нужен артикул"), args[1]); break
			case "prices": {
				const b = await resolveBrand(args[0] ?? die("нужен артикул"), args[1])
				out(await api.offers(args[0]!, b.id)); break
			}
			case "analogs": {
				const b = await resolveBrand(args[0] ?? die("нужен артикул"), args[1])
				out(await api.analogs(args[0]!, b.id)); break
			}
			case "basket":    out(await api.basket()); break
			case "favorites": {
				if (!args[0]) { out(await api.favoriteLists()); break }
				const listId = Number(args[0])
				if (!Number.isFinite(listId)) die(`listId должен быть числом, а не «${args[0]}»`)
				out(await api.favorites(listId))
				break
			}
			case "orders":    out(await api.orders()); break
			case "garage":    await cmdGarage(args[0], args[1]); break
			case "profile":   out(await api.profile()); break
			case "login":     await cmdLogin(); break
			case "logout": {
				const had = await auth.loadTokens()
				await auth.clearTokens()
				console.log(had ? `токен удалён — ${dim(auth.accountPath())}` : dim("токена и не было"))
				break
			}
			case "whoami":    await cmdWhoami(); break
			case "get":       out(await api.raw("GET", args[0] ?? die("нужен путь"), kv(args.slice(1)), flags.auth === true)); break
			case "post":      out(await api.raw("POST", args[0] ?? die("нужен путь"), kv(args.slice(1)), flags.auth === true)); break
			default:          die(`неизвестная команда: ${cmd}`)
		}
	} catch (e) {
		if (e instanceof ApiError) die(e.message)
		die(e instanceof Error ? e.message : String(e))
	}
}

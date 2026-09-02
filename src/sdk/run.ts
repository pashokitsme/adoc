// run.ts — из объявления провайдера делает CLI: argv → команда → JSON или
// рендер → exit-код. С --json в stdout ровно один объект.

import { accountStore } from "./account.ts"
import { hasTTY, intFlag, need, parseArgv, parseRef, positiveInt, readLine, readSecret } from "./cli.ts"
import { CONTRACT_VERSION, type Basket, type Command, type Describe } from "./contract.ts"
import type { Ctx, ProviderSpec } from "./define.ts"
import { ProviderError, errorBody, exitCode, type ErrorMapper } from "./errors.ts"
import { HttpError } from "./http.ts"
import { emit, warnSink } from "./out.ts"
import { bold, dim, fields, linksHint, red, renderBasket, renderBrands, renderCars, renderDisplay, renderInfo, renderOffers, renderOrders, renderProducts, renderReviews } from "./render.ts"
import { NO_WARN_ENV, TOOL } from "./config.ts"

const CONTRACT_VALUE_FLAGS = ["brand", "page", "limit", "qty", "ref", "car"]

// Мапперу провайдера — первое слово; HttpError из SDK не должен уезжать в
// internal, а всё незнакомое toProviderError и так сведёт к internal.
// Композиция живёт здесь: errors.ts не знает про http.ts, иначе был бы цикл.
const withHttp = (own?: ErrorMapper): ErrorMapper => e =>
	own?.(e) ?? (e instanceof HttpError ? new ProviderError("http", e.message) : null)

// Терминал нужен не команде login, а самому вопросу: провайдер, который берёт
// логин и пароль из окружения или файла, обязан входить и без tty. Поэтому
// проверка сидит на ctx.prompt/ctx.secret — спросить без терминала нельзя,
// а войти молча можно.
const needTTY = (read: (q: string) => Promise<string>) => async (q: string): Promise<string> => {
	if (!hasTTY()) throw new ProviderError("tty", "login нужен терминал: запускать без пайпа")
	return await read(q)
}

/** Номер страницы и размер выдачи: только целое ≥ 1. */
const pageNum = (name: string, v: string | true | undefined, def: number): number =>
	v === undefined ? def : positiveInt(`--${name}`, v)

function contractCommands<A>(spec: ProviderSpec<A>): Command[] {
	const c: Command[] = [
		{ name: "describe", usage: "describe", about: "что умеет провайдер", auth: false },
		{ name: "login", usage: "login", about: "войти (диалог в терминале, если провайдер не берёт данные иначе)", auth: false },
		{ name: "logout", usage: "logout", about: "забыть аккаунт", auth: false },
		{ name: "whoami", usage: "whoami", about: "кто авторизован", auth: false },
		{ name: "search", usage: "search <текст> [--car <json>] [--page <n>] [--limit <n>]", about: "поиск по названию; --car — ref машины из `garage export`", auth: false },
		{ name: "brands", usage: "brands <артикул>", about: "кто выпускает артикул", auth: false },
		{ name: "offers", usage: "offers <артикул> --brand <имя> [--analogs]", about: "предложения: цена, наличие, срок", auth: false },
		{ name: "info", usage: "info <артикул> --brand <имя>", about: "карточка и все предложения по артикулу", auth: false },
		{ name: "analogs", usage: "analogs <артикул> --brand <имя>", about: "только аналоги, без точных совпадений", auth: false },
	]
	if (spec.orders) c.push({ name: "orders", usage: "orders", about: "заказы на сайте", auth: true })
	if (spec.reviews) c.push({ name: "reviews", usage: "reviews <артикул> --brand <имя> [--page <n>] [--limit <n>]", about: "оценки и отзывы", auth: false })
	if (spec.garageExport) c.push({ name: "garage export", usage: "garage export", about: "машины из гаража сайта", auth: true })
	if (spec.basket) c.push(
		{ name: "basket", usage: "basket", about: "корзина", auth: true },
		{ name: "basket add", usage: "basket add --ref <json> [--qty <n>]", about: "положить предложение (ref из offers)", auth: true },
		{ name: "basket set", usage: "basket set <itemId> --qty <n>", about: "изменить количество", auth: true },
		{ name: "basket rm", usage: "basket rm <itemId>", about: "убрать позицию", auth: true },
	)
	for (const [name, cmd] of Object.entries(spec.commands ?? {})) c.push({ name, usage: cmd.usage, about: cmd.about, auth: cmd.auth })
	return c
}

function describe<A>(spec: ProviderSpec<A>): Describe {
	return { contract: CONTRACT_VERSION, id: spec.id, name: spec.name, site: spec.site, capabilities: spec.capabilities, commands: contractCommands(spec) }
}

function usage<A>(spec: ProviderSpec<A>): string {
	const cmds = contractCommands(spec)
	const w = Math.max(...cmds.map(c => c.usage.length))
	return [
		`${bold(`${TOOL}-${spec.id}`)} — ${spec.name}, ${spec.site}`,
		"",
		...cmds.map(c => `  ${c.usage.padEnd(w)}  ${c.about}${c.auth ? dim("  (нужен вход)") : ""}`),
		"",
		dim("  --json — один JSON-объект в stdout вместо таблиц"),
		dim("  --quiet, -q — без предупреждений в stderr; то же, что ADOC_NO_WARN=1"),
	].join("\n")
}

type Out = { json: unknown; render: () => string }

async function dispatch<A>(spec: ProviderSpec<A>, ctx: Ctx<A>, args: string[]): Promise<Out> {
	const [cmd, ...rest] = args
	const brandFlag = (): string => {
		const b = ctx.flags.brand
		if (typeof b !== "string" || !b) throw new ProviderError("bad_args", "нужен --brand <имя>")
		return b
	}

	switch (cmd) {
		case "describe": {
			const d = describe(spec)
			return { json: d, render: () => fields([["id", d.id], ["сайт", d.site], ["контракт", String(d.contract)], ["умеет", d.capabilities.join(", ") || "—"]]) }
		}
		case "login": {
			const r = await spec.login(ctx)
			await ctx.saveAccount(r.account)
			return { json: { account: r.account, display: r.display }, render: () => renderDisplay(r.display) }
		}
		case "logout": {
			const had = ctx.account !== null
			await ctx.saveAccount(null)
			return { json: { ok: true, had }, render: () => (had ? "аккаунт удалён" : dim("аккаунта и не было")) }
		}
		case "whoami": {
			const d = ctx.account ? await spec.whoami(ctx) : null
			return { json: d ? { ok: true, display: d } : { ok: false }, render: () => renderDisplay(d) }
		}
		case "search": {
			// --car отсутствует — ищем без машины; пустая строка тоже не машина,
			// иначе `--car ""` уехало бы в parseRef и упало непонятной ошибкой.
			const car = ctx.flags.car === undefined || ctx.flags.car === "" ? null : parseRef(ctx.flags.car, "car", "`garage export`")
			const r = await spec.search(ctx, need(rest.join(" ") || undefined, "текст запроса"), { car })
			return { json: r, render: () => renderProducts(r.items) }
		}
		case "brands": {
			const r = await spec.brands(ctx, need(rest[0], "артикул"))
			return { json: r, render: () => renderBrands(r.items) }
		}
		case "offers": {
			const r = await spec.offers(ctx, need(rest[0], "артикул"), brandFlag(), { analogs: ctx.flags.analogs === true })
			return { json: r, render: () => renderOffers(r.items) }
		}
		case "info": {
			const r = await spec.info(ctx, need(rest[0], "артикул"), brandFlag())
			return { json: r, render: () => renderInfo(r.info, r.offers ?? []) }
		}
		case "analogs": {
			const r = await spec.analogs(ctx, need(rest[0], "артикул"), brandFlag())
			return { json: r, render: () => renderOffers(r.items) }
		}
		case "orders": {
			if (!spec.orders) break
			const r = await spec.orders(ctx)
			return { json: r, render: () => renderOrders(r.items) }
		}
		case "reviews": {
			if (!spec.reviews) break
			const r = await spec.reviews(ctx, need(rest[0], "артикул"), brandFlag())
			return { json: r, render: () => renderReviews(r) }
		}
		case "garage": {
			if (rest[0] === "export" && spec.garageExport) {
				const r = await spec.garageExport(ctx)
				return { json: r, render: () => renderCars(r.cars) }
			}
			break
		}
		case "basket": {
			if (!spec.basket) break
			const b = spec.basket
			const sub = rest[0]
			let r: Basket
			if (sub === undefined) r = await b.list(ctx)
			else if (sub === "add") r = await b.add(ctx, parseRef(ctx.flags.ref), intFlag("qty", ctx.flags.qty) ?? 1)
			else if (sub === "set") {
				if (ctx.flags.qty === undefined) throw new ProviderError("bad_args", "нужен --qty <n>")
				r = await b.set(ctx, need(rest[1], "itemId"), intFlag("qty", ctx.flags.qty) ?? 1)
			}
			else if (sub === "rm") r = await b.remove(ctx, need(rest[1], "itemId"))
			else throw new ProviderError("bad_args", `неизвестная подкоманда корзины: ${sub}`)
			return { json: r, render: () => renderBasket(r) }
		}
	}

	// Своя команда провайдера. Сюда же проваливаются reviews/garage/basket, когда
	// провайдер не реализовал метод: имя тогда свободно под свою команду.
	// hasOwn обязателен: иначе `toString` нашёлся бы в прототипе и вместо
	// bad_args вылез бы internal с текстом из движка.
	const commands = spec.commands ?? {}
	const own = cmd && Object.hasOwn(commands, cmd) ? commands[cmd] : undefined
	if (!own) throw new ProviderError("bad_args", `неизвестная команда: ${cmd ?? "(пусто)"}`)
	const r = await own.run(ctx, rest)
	return { json: r.json, render: r.render ?? (() => JSON.stringify(r.json, null, 2)) }
}

export async function runProvider<A>(spec: ProviderSpec<A>, argv: string[] = process.argv.slice(2)): Promise<never> {
	// Разбор argv умеет падать, а форма ответа зависит от --json: флаг ищем в
	// сыром argv, иначе ошибка разбора уехала бы машинному вызову таблицей.
	const json = argv.some(a => a === "--json" || a === "--json=true")

	try {
		const { args, flags } = parseArgv(argv, [...CONTRACT_VALUE_FLAGS, ...(spec.valueFlags ?? [])])
		// --quiet — тот же ADOC_NO_WARN на один вызов; ctx.warn читает её сам.
		if (flags.quiet === true) process.env[NO_WARN_ENV] = "1"

		if (!args.length || flags.help) {
			// Машинному вызову таблица бесполезна: он ждёт JSON и получил бы
			// исключение разбора вместо внятной ошибки.
			if (json) {
				const why = flags.help ? "--help не отдаётся в JSON: список команд — describe --json" : "нужна команда: --help или describe"
				return await emit(process.stdout, JSON.stringify(errorBody(new ProviderError("bad_args", why))) + "\n", 1)
			}
			return await emit(process.stdout, usage(spec) + "\n", 0)
		}

		const store = accountStore<A>(spec.id)
		const ctx: Ctx<A> = {
			account: await store.load(),
			saveAccount: async a => {
				if (a === null) await store.clear()
				else await store.save(a)
				ctx.account = a
			},
			json,
			flags,
			page: 1,
			limit: 30,
			prompt: needTTY(readLine),
			secret: needTTY(readSecret),
			warn: warnSink(m => process.stderr.write(`${m}\n`)),
		}

		ctx.page = pageNum("page", flags.page, 1)
		ctx.limit = pageNum("limit", flags.limit, 30)
		const out = await dispatch(spec, ctx, args)
		if (json) return await emit(process.stdout, JSON.stringify(out.json) + "\n", 0)
		// Подсказка про клик — одна на весь вывод и только когда ссылки в нём
		// и правда вшиты: правило то же, что у обёртки.
		const text = out.render()
		const tip = linksHint(text)
		return await emit(process.stdout, text + (tip ? `\n${tip}` : "") + "\n", 0)
	} catch (e) {
		// Один разбор ошибки на оба вывода: код в JSON и код в exit-е — из
		// одного места, иначе текстовый и машинный ответы разошлись бы.
		const body = errorBody(e, withHttp(spec.mapError))
		const { code, message, items } = body.error
		if (json) return await emit(process.stdout, JSON.stringify(body) + "\n", exitCode(code))
		const text = red(message) + "\n" + (items?.length ? renderBrands(items) + "\n" : "")
		return await emit(process.stderr, text, exitCode(code))
	}
}

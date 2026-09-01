// run.ts — из объявления провайдера делает CLI: argv → команда → JSON или
// рендер → exit-код. С --json в stdout ровно один объект.

import { accountStore } from "./account.ts"
import { hasTTY, parseArgv, readLine, readSecret } from "./cli.ts"
import { CONTRACT_VERSION, type Basket, type Command, type Describe } from "./contract.ts"
import type { Ctx, ProviderSpec } from "./define.ts"
import { ProviderError, errorBody, exitCode, type ErrorMapper } from "./errors.ts"
import { HttpError } from "./http.ts"
import { bold, dim, fields, red, renderBasket, renderBrands, renderCars, renderDisplay, renderOffers, renderProducts, renderReviews } from "./render.ts"
import { TOOL } from "./config.ts"

const CONTRACT_VALUE_FLAGS = ["brand", "page", "limit", "qty", "ref"]

// Мапперу провайдера — первое слово; HttpError из SDK не должен уезжать в
// internal, а всё незнакомое toProviderError и так сведёт к internal.
// Композиция живёт здесь: errors.ts не знает про http.ts, иначе был бы цикл.
const withHttp = (own?: ErrorMapper): ErrorMapper => e =>
	own?.(e) ?? (e instanceof HttpError ? new ProviderError("http", e.message) : null)

function num(name: string, v: string | true | undefined, def: number): number {
	if (v === undefined) return def
	if (v === true || v === "") throw new ProviderError("bad_args", `--${name}: нужно значение`)
	const n = Number(v)
	if (!Number.isFinite(n) || n < 0) throw new ProviderError("bad_args", `--${name}: нужно неотрицательное число, а не «${v}»`)
	return n
}

function contractCommands<A>(spec: ProviderSpec<A>): Command[] {
	const c: Command[] = [
		{ name: "describe", usage: "describe", about: "что умеет провайдер", auth: false },
		{ name: "login", usage: "login", about: "войти (диалог в терминале)", auth: false },
		{ name: "logout", usage: "logout", about: "забыть аккаунт", auth: false },
		{ name: "whoami", usage: "whoami", about: "кто авторизован", auth: false },
		{ name: "search", usage: "search <текст> [--page <n>] [--limit <n>]", about: "поиск по названию", auth: false },
		{ name: "brands", usage: "brands <артикул>", about: "кто выпускает артикул", auth: false },
		{ name: "offers", usage: "offers <артикул> --brand <имя> [--analogs]", about: "предложения: цена, наличие, срок", auth: false },
	]
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
	].join("\n")
}

function parseRef(v: string | true | undefined): Record<string, unknown> {
	if (typeof v !== "string" || !v) throw new ProviderError("bad_args", "нужен --ref <json> из выдачи offers")
	try {
		const o = JSON.parse(v) as unknown
		if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error()
		return o as Record<string, unknown>
	} catch {
		throw new ProviderError("bad_args", "--ref должен быть JSON-объектом")
	}
}

type Out = { json: unknown; render: () => string }

type Sink = { write(text: string, cb: () => void): unknown }

// Единственная точка выхода. process.exit рубит всё, что ещё не ушло в трубу:
// через пайп оболочки Bun 1.3 теряет хвост за первым буфером (64 КБ), и ответ
// крупнее буфера уезжал бы обрезанным с кодом 0 — успех на неразбираемом JSON.
// Поэтому сначала дожидаемся слива, потом выходим.
async function emit(sink: Sink, text: string, code: number): Promise<never> {
	await new Promise<void>(resolve => sink.write(text, () => resolve()))
	process.exit(code)
}

async function dispatch<A>(spec: ProviderSpec<A>, ctx: Ctx<A>, args: string[]): Promise<Out> {
	const [cmd, ...rest] = args
	const need = (v: string | undefined, what: string): string => {
		if (!v) throw new ProviderError("bad_args", `нужен ${what}`)
		return v
	}
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
			if (!hasTTY()) throw new ProviderError("tty", "login нужен терминал: запусти без пайпа")
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
			const r = await spec.search(ctx, need(rest.join(" ") || undefined, "текст запроса"))
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
			else if (sub === "add") r = await b.add(ctx, parseRef(ctx.flags.ref), num("qty", ctx.flags.qty, 1))
			else if (sub === "set") {
				if (ctx.flags.qty === undefined) throw new ProviderError("bad_args", "нужен --qty <n>")
				r = await b.set(ctx, need(rest[1], "itemId"), num("qty", ctx.flags.qty, 1))
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
	const { args, flags } = parseArgv(argv, [...CONTRACT_VALUE_FLAGS, ...(spec.valueFlags ?? [])])
	const json = flags.json === true

	if (!args.length || flags.help) {
		// Машинному вызову таблица бесполезна: он ждёт JSON и получил бы
		// исключение разбора вместо внятной ошибки.
		if (json) {
			const why = flags.help ? "--help не отдаётся в JSON: список команд — describe --json" : "нужна команда: смотри --help или describe"
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
		limit: 10,
		prompt: readLine,
		secret: readSecret,
		warn: m => process.stderr.write(`${m}\n`),
	}

	try {
		ctx.page = num("page", flags.page, 1)
		ctx.limit = num("limit", flags.limit, 10)
		const out = await dispatch(spec, ctx, args)
		return await emit(process.stdout, (json ? JSON.stringify(out.json) : out.render()) + "\n", 0)
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

// accounts.ts — менеджер аккаунтов. Обёртка не хранит ни одного секрета:
// login целиком делегируется провайдеру, logout удаляет его файл, whoami
// спрашивает сам провайдер. Тело login содержит токены и наружу не идёт.

import { ProviderError, TOOL, bold, dim, green, need, renderDisplay, yellow } from "../sdk/index.ts"
import type { Display, WhoamiResult } from "../sdk/index.ts"
import { listing, one } from "../core/args.ts"
import { LOGIN_TIMEOUT_MS, invoke, passNoise } from "../core/invoke.ts"
import { blame, fanout, report } from "../core/partial.ts"
import { accountsTable, hint, type AccountRow } from "../core/render.ts"
import { listAccountIds, removeAccount } from "../core/store.ts"
import { parseWhoami } from "../core/validate.ts"
import type { Ctx, Output } from "../core/ctx.ts"
import type { Provider } from "../core/registry.ts"

/** `accounts` и `whoami` — одна и та же таблица; второе имя привычнее. */
export async function cmdAccounts(ctx: Ctx): Promise<Output> {
	const wanted = ctx.args[0]
	// Пустой выбор здесь законен: провайдеров может не быть вовсе, а файлы
	// аккаунтов от них остаться — как раз тогда о них и надо сказать.
	const all = await ctx.pick(undefined, { allowEmpty: true })
	const providers = wanted ? [await one(ctx, wanted)] : all

	const f = await fanout(providers, p => invoke(p.bin, ["whoami"], { id: p.id }), parseWhoami, ctx.warn)
	const byId = new Map(f.got.map(g => [g.provider, g.value]))
	const failed = new Map(f.failures.map(x => [x.provider, x.message]))

	const rows: AccountRow[] = providers.map(p => {
		const w: WhoamiResult | undefined = byId.get(p.id)
		const note = failed.get(p.id)
		return { provider: p.id, ok: w?.ok === true, ...(w?.display ? { display: w.display } : {}), ...(note ? { note } : {}) }
	})

	// Файл аккаунта есть, а провайдера нет: чаще всего сайт удалили из PATH.
	// Молчать нельзя — файл с токенами лежит и его надо либо вернуть, либо убрать.
	// Сирота считается по всему реестру, а не по выбранным: провайдер, убранный
	// через --skip, никуда не делся, и звать на него logout не за что.
	const known = new Set((await ctx.load()).ok.map(p => p.id))
	const orphans = (await listAccountIds()).filter(id => !known.has(id))

	const json = {
		accounts: rows.map(r => ({ provider: r.provider, ok: r.ok, ...(r.display ? { display: r.display } : {}), ...(r.note ? { error: r.note } : {}) })),
		orphans,
		errors: f.failures,
	}
	const code = report(f, [], ctx.warn)
	// Сироты печатаются под таблицей, а не уходят в stderr: это подсказка, что
	// делать дальше, а не отказ, и в --json они лежат отдельным полем.
	const body = providers.length ? accountsTable(rows) : dim(`ни одного провайдера — ${TOOL} providers`)
	const notes = orphans.map(id => hint(`${id}: есть файл аккаунта, а провайдера нет — ${TOOL} logout ${id}`))
	return { json, render: () => [body, ...notes].join("\n"), code }
}

export async function cmdLogin(ctx: Ctx): Promise<Output> {
	const p = await one(ctx, ctx.args[0])

	// Единственная команда, чей диалог идёт прямо в терминал: подсказку
	// «Пароль >» нельзя копить до конца, её надо показать до ввода. Поэтому
	// invoke наследует stdin и льёт stderr провайдера сразу — это объявленное
	// исключение из инварианта app.ts «сам ничего не печатает».
	// Таймаут общий (30 с) человеку с паролем короток.
	const r = await invoke(p.bin, ["login"], { interactive: true, timeoutMs: LOGIN_TIMEOUT_MS, id: p.id })
	passNoise(p.id, r, ctx.warn)
	// В stdout login лежит аккаунт целиком, вместе с токенами. Отсюда берётся
	// только факт успеха; тело не печатается, не сохраняется и не разбирается.
	if (!r.ok) throw new ProviderError(r.error.code, blame(p.id, r.error.message))

	// Кто вошёл — спрашиваем отдельным whoami: у него в ответе ровно display и
	// ничего секретного.
	const { display, problem } = await whoamiOf(ctx, p)
	return {
		json: { ok: true, provider: p.id, ...(display ? { display } : {}) },
		// Вход уже состоялся, и «не авторизован» после него — прямая ложь:
		// упал второй вызов, а не login, и так и написано.
		render: () => (problem
			? `${green("вошли")} в ${bold(p.id)}, но whoami не ответил: ${problem}`
			: `${green("вошли")} ${bold(p.id)}\n${renderDisplay(display)}`),
	}
}

async function whoamiOf(ctx: Ctx, p: Provider): Promise<{ display?: Display; problem?: string }> {
	const r = await invoke(p.bin, ["whoami"], { id: p.id })
	passNoise(p.id, r, ctx.warn)
	if (!r.ok) return { problem: blame(p.id, r.error.message) }
	try {
		const w = parseWhoami(r.json, p.id)
		return w.ok && w.display ? { display: w.display } : {}
	} catch (e) {
		return { problem: blame(p.id, e instanceof Error ? e.message : String(e)) }
	}
}

export async function cmdLogout(ctx: Ctx): Promise<Output> {
	const id = need(ctx.args[0], `имя провайдера — список: ${TOOL} providers`)
	const { ok } = await ctx.load()
	const p = ok.find(x => x.id === id)

	// Имя сверяется с реестром и с каталогом аккаунтов до похода в store:
	// «нет такого, есть вот эти» полезнее, чем «недопустимый id» из глубины.
	// Проверка внутри removeAccount при этом остаётся второй линией обороны.
	const files = await listAccountIds()
	const names = [...new Set([...ok.map(x => x.id), ...files])].sort()
	if (!names.includes(id)) throw new ProviderError("bad_args", `нет ни провайдера «${id}», ни его файла аккаунта — есть ${listing(names)}`)

	let had = false
	if (p) {
		const r = await invoke(p.bin, ["logout"], { id: p.id })
		passNoise(p.id, r, ctx.warn)
		if (r.ok) had = (r.json as { had?: unknown }).had === true
		else ctx.warn(yellow(blame(id, r.error.message)))
	}
	// Даже если провайдера уже нет, файл убрать надо: токены не должны
	// переживать logout.
	if (await removeAccount(id)) had = true

	return { json: { ok: true, provider: id, had }, render: () => (had ? `аккаунт ${bold(id)} удалён` : dim(`аккаунта ${id} и не было`)) }
}

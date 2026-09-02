// providers.ts — что подключено. Единственная команда, которая показывает и
// сломанных провайдеров: остальным они не видны, в агрегацию не попадают.
// Статус аккаунта берётся по наличию файла, а не вызовом whoami: список
// провайдеров должен печататься мгновенно и без сети.

import { providersTable } from "../core/render.ts"
import { listAccountIds } from "../core/store.ts"
import type { Ctx, Output } from "../core/ctx.ts"

export async function cmdProviders(ctx: Ctx): Promise<Output> {
	const { ok, bad } = await ctx.load()
	const accounts = new Set(await listAccountIds())
	const json = {
		providers: ok.map(p => ({
			id: p.id, name: p.describe.name, site: p.describe.site, contract: p.describe.contract,
			capabilities: p.describe.capabilities, commands: p.describe.commands.map(c => c.name),
			source: p.source, bin: p.bin.join(" "), account: accounts.has(p.id),
		})),
		broken: bad.map(b => ({ id: b.id, bin: b.bin.join(" "), message: b.message })),
	}
	return { json, render: () => providersTable(ok, bad, accounts) }
}

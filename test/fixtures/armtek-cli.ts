// Провайдер armtek, поднятый как отдельный процесс, но с сетью, подменённой
// фикстурами: так проверяется поведение целого CLI — что уходит в stdout, что
// в stderr и какой код возврата. Маршрут задаётся ARMTEK_FIXTURES: JSON вида
// {"<кусок пути или queryType:N>": "<файл фикстуры>"}.

import { readFileSync } from "node:fs"
import { setTransport } from "../../src/providers/armtek/api.ts"
import { armtek } from "../../src/providers/armtek/provider.ts"
import { runProvider } from "../../src/sdk/index.ts"

const routes = JSON.parse(process.env.ARMTEK_FIXTURES ?? "{}") as Record<string, string>

setTransport(async (url, init) => {
	const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined
	const keys = [...(body?.queryType !== undefined ? [`queryType:${body.queryType}`] : []), url]
	for (const [pattern, file] of Object.entries(routes)) {
		if (keys.some(k => k.includes(pattern))) return JSON.parse(readFileSync(file, "utf8"))
	}
	throw new Error(`нет фикстуры для ${url}`)
})

await runProvider(armtek)

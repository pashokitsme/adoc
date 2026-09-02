#!/usr/bin/env bun
// adoc — агрегатор магазинов автозапчастей. Справка: adoc --help.

import { run } from "./app.ts"
import { passthrough } from "./commands/passthrough.ts"
import { drain, emit } from "./sdk/index.ts"

const argv = process.argv.slice(2)

// Проброс идёт мимо run(): вывод провайдера — его собственный, обёртка его не
// читает, не переписывает и не буферизует. Имена команд обёртки проброс не
// забирает, так что до run() доходит ровно то, что она и разбирает.
const passed = await passthrough(argv)
if (passed !== null) process.exit(passed)

const r = await run(argv)
// Слив stderr дожидается так же, как emit — слива stdout: без этого длинное
// предупреждение или сообщение об ошибке обрывалось бы на первом буфере пайпа.
await drain(process.stderr, r.stderr)
await emit(process.stdout, r.stdout, r.code)

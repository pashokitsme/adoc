#!/usr/bin/env bun
// adoc — агрегатор магазинов автозапчастей. Справка: adoc --help.

import { run } from "./app.ts"
import { drain, emit } from "./sdk/index.ts"

const r = await run(process.argv.slice(2))
// Слив stderr дожидается так же, как emit — слива stdout: без этого длинное
// предупреждение или сообщение об ошибке обрывалось бы на первом буфере пайпа.
await drain(process.stderr, r.stderr)
await emit(process.stdout, r.stdout, r.code)

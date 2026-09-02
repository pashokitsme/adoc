#!/usr/bin/env bun
// adoc-autodoc — провайдер autodoc.ru. Справка: adoc-autodoc --help.
import { runProvider } from "../../sdk/index.ts"
import { migrateLegacyToken } from "./auth.ts"
import { autodoc } from "./provider.ts"

await migrateLegacyToken()
await runProvider(autodoc)

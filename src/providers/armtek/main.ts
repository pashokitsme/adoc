#!/usr/bin/env bun
// main.ts — точка входа провайдера armtek: adoc-armtek <команда>.

import { runProvider } from "../../sdk/index.ts"
import { armtek } from "./provider.ts"

await runProvider(armtek)

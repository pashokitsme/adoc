// commands.ts — команды autodoc сверх контракта. Наполняется в следующей задаче.
import type { ProviderCommand } from "../../sdk/define.ts"
import type { Tokens } from "./auth.ts"

export const commands: Record<string, ProviderCommand<Tokens>> = {}

// errors.ts — ошибка провайдера и её вид наружу.

import type { BrandHit, ErrorBody, ErrorCode } from "./contract.ts"

export class ProviderError extends Error {
	constructor(readonly code: ErrorCode, message: string, readonly items?: BrandHit[]) {
		super(message)
	}
}

export const exitCode = (code: ErrorCode): 1 | 2 => (code === "ambiguous" ? 2 : 1)

export type ErrorMapper = (e: unknown) => ProviderError | null

export function toProviderError(e: unknown, map?: ErrorMapper): ProviderError {
	if (e instanceof ProviderError) return e
	const mapped = map?.(e)
	if (mapped) return mapped
	return new ProviderError("internal", e instanceof Error ? e.message : String(e))
}

export function errorBody(e: unknown, map?: ErrorMapper): ErrorBody {
	const pe = toProviderError(e, map)
	return { error: { code: pe.code, message: pe.message, ...(pe.items ? { items: pe.items } : {}) } }
}

// Публичная поверхность SDK. И провайдеры, и агрегатор берут отсюда всё:
// второго входа в SDK нет, глубоких импортов вида ../sdk/render.ts быть не должно.
export { defineProvider } from "./define.ts"
export type { BasketOps, CommandResult, Ctx, ProviderCommand, ProviderSpec, SearchOpts } from "./define.ts"
export { runProvider } from "./run.ts"
export { drain, emit } from "./out.ts"
export type { Sink } from "./out.ts"
export { ProviderError, errorBody, exitCode, toProviderError } from "./errors.ts"
export type { ErrorMapper } from "./errors.ts"
export { HttpError, fetchJson } from "./http.ts"
export { articleKey, brandKey } from "./keys.ts"
export { decodeClaims } from "./jwt.ts"
export { hasTTY, intFlag, need, parseArgv, parseRef, positiveInt, readLine, readSecret } from "./cli.ts"
export type { Flags } from "./cli.ts"
export { accountStore } from "./account.ts"
export type { AccountStore } from "./account.ts"
export { CONFIG_DIR_ENV, TOOL, configDir } from "./config.ts"
export * from "./contract.ts"
export {
	LINKS_HINT, bar, basketTotal, bold, cyan, days, dim, fields, fold, green, heading, hyperlink, isoDate, link,
	linksHint, linksMode, money, qtyCell, ratingCell, red, renderBasket, renderBrands, renderCars, renderDisplay,
	renderInfo, renderOffers, renderOrders, renderProducts, renderReviews, stars, table, urlList, yellow,
} from "./render.ts"
export type { CarLike, Col, LinksMode } from "./render.ts"
export * as render from "./render.ts"

import { runProvider } from "../../../../src/sdk/index.ts"
import { makeFake } from "../../fake/provider.ts"

// Артикул и бренд написаны «канонично», цена выше, чем у beta.
await runProvider(makeFake("alpha", { article: "N90954802", brand: "VAG", price: 407, seller: "склад А" }))

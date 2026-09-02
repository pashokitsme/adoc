import { runProvider } from "../../../../src/sdk/index.ts"
import { makeFake } from "../../fake/provider.ts"

// Тот же товар другим написанием и дешевле: на этой паре проверяется склейка
// по ключам артикула и бренда и сортировка по цене.
await runProvider(makeFake("beta", { article: "N 909 548 02", brand: "vag", price: 380, seller: "склад Б" }))

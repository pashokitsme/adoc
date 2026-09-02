// describe без обязательных полей: такой провайдер в агрегацию не попадает.
process.stdout.write(`${JSON.stringify({ contract: 1, id: "broken" })}\n`)

// Провайдер-грязнуля: печатает мусор вокруг JSON и строку в stderr. Не SDK:
// именно так себя ведёт чужая реализация контракта на другом языке.
// NOISY_STDERR_BYTES — вывалить столько байт в stderr до ответа: на этом
// проверяется, что обёртка читает обе трубы разом. Читатель по очереди тут
// встаёт намертво — ребёнок ждёт, пока разберут stderr, а обёртка ждёт stdout.

const cmd = process.argv[2]
const body = cmd === "describe"
	? { contract: 1, id: "noisy", name: "Noisy", site: "https://noisy.example", capabilities: [], commands: [] }
	: { items: [] }
const bulk = Number(process.env.NOISY_STDERR_BYTES ?? "0")
if (Number.isFinite(bulk) && bulk > 0) process.stderr.write(`${"x".repeat(bulk)}\n`)
process.stderr.write("noisy: сайт просил подождать\n")
process.stdout.write(`мусор до\n${JSON.stringify(body)}\nмусор после\n`)

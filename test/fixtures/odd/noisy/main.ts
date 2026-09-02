// Провайдер-грязнуля: печатает мусор вокруг JSON и строку в stderr. Не SDK:
// именно так себя ведёт чужая реализация контракта на другом языке.

const cmd = process.argv[2]
const body = cmd === "describe"
	? { contract: 1, id: "noisy", name: "Noisy", site: "https://noisy.example", capabilities: [], commands: [] }
	: { items: [] }
process.stderr.write("noisy: сайт просил подождать\n")
process.stdout.write(`мусор до\n${JSON.stringify(body)}\nмусор после\n`)

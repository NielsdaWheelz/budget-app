declare const Bun: {
	serve: (options: {
		port: number
		fetch: (req: Request) => Response
	}) => { port: number }
	file: (path: string) => BodyInit
}

const server = Bun.serve({
	port: 3000,
	fetch(req: Request) {
		const url = new URL(req.url)
		const path = url.pathname === "/" ? "/index.html" : url.pathname
		const file = Bun.file(`dist${path}`)
		return new Response(file)
	},
})
console.log(`Server running at http://localhost:${server.port}`)

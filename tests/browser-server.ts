import { BunContext } from "@effect/platform-bun"
import { Effect, Layer } from "effect"
import { makeApp } from "../src/server/app"
import { migrate } from "../src/server/migrations"
import { startDatabase } from "./database"

let stop: () => void = () => {}
const stopped = new Promise<void>((resolve) => {
	stop = resolve
})
process.once("SIGTERM", stop)
process.once("SIGINT", stop)
const database = await startDatabase()
let app: ReturnType<typeof makeApp> | undefined
let server: ReturnType<typeof Bun.serve> | undefined
try {
	await Effect.runPromise(
		migrate.pipe(Effect.provide(Layer.mergeAll(database.layer, BunContext.layer))),
	)
	const application = makeApp({
		database: database.config,
		authentication: {
			origin: "http://127.0.0.1:4174",
			ownerEmail: "journey@example.test",
			readTokenSha256: new Bun.CryptoHasher("sha256")
				.update("synthetic-read-token-for-browser-proof")
				.digest("hex"),
			writeTokenSha256: new Bun.CryptoHasher("sha256")
				.update("synthetic-write-token-for-browser-proof")
				.digest("hex"),
		},
	})
	app = application
	server = Bun.serve({
		hostname: "127.0.0.1",
		port: 4174,
		fetch: async (request) => {
			const path = new URL(request.url).pathname
			if (path.startsWith("/api/")) return application.fetch(request)
			if (/^\/assets\/[\w.-]+$/.test(path)) {
				const file = Bun.file(`.vercel/output/static${path}`)
				return (await file.exists())
					? new Response(file)
					: new Response("not found", { status: 404 })
			}
			if (/^\/(planner|history|inbox)?\/?$/.test(path))
				return new Response(Bun.file(".vercel/output/static/index.html"))
			return new Response("not found", { status: 404 })
		},
	})
	await stopped
} finally {
	process.removeListener("SIGTERM", stop)
	process.removeListener("SIGINT", stop)
	try {
		await server?.stop(true)
		await app?.dispose()
	} finally {
		await database.close()
	}
}

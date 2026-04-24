import { HttpApiBuilder, HttpServer } from "@effect/platform"
import { PgClient } from "@effect/sql-pg"
import { Layer, Redacted } from "effect"
import { BudgetApi } from "../src/server/api"
import { makeHandlersLayer } from "../src/server/handlers"

let cached: { handler: (req: Request) => Promise<Response> } | null = null

async function getHandler() {
	if (cached) return cached.handler

	const url = process.env.DATABASE_URL
	if (!url) throw new Error("DATABASE_URL environment variable is required")

	const DbLayer = PgClient.layer({ url: Redacted.make(url), ssl: true })

	const { handler } = HttpApiBuilder.toWebHandler(
		HttpApiBuilder.api(BudgetApi).pipe(
			Layer.provide(makeHandlersLayer(DbLayer)),
			Layer.merge(HttpServer.layerContext),
		),
	)

	cached = { handler }
	return handler
}

export default {
	async fetch(request: Request) {
		const handler = await getHandler()
		return handler(request)
	},
}

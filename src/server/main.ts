import { HttpApiBuilder, HttpServer } from "@effect/platform"
import { PgClient } from "@effect/sql-pg"
import { Duration, Layer, Redacted } from "effect"
import { BudgetApi } from "./api"
import { HandlersLayer } from "./handlers"

const url = process.env.DATABASE_URL_UNPOOLED
if (!url) throw new Error("DATABASE_URL_UNPOOLED is required")

const DbLayer = PgClient.layer({
	url: Redacted.make(url),
	ssl: true,
	connectTimeout: Duration.seconds(30),
})

const { handler } = HttpApiBuilder.toWebHandler(
	HttpApiBuilder.api(BudgetApi).pipe(
		Layer.provide(HandlersLayer),
		Layer.provide(DbLayer),
		Layer.merge(HttpServer.layerContext),
	),
)

export default { fetch: handler }

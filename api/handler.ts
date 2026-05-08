import { HttpApiBuilder, HttpServer } from "@effect/platform"
import { PgClient } from "@effect/sql-pg"
import { Layer, Redacted } from "effect"
import { BudgetApi } from "../src/server/api"
import { HandlersLayer } from "../src/server/handlers"

const url = process.env.DATABASE_URL_UNPOOLED
if (!url) throw new Error("DATABASE_URL_UNPOOLED is required")

const DbLayer = PgClient.layer({ url: Redacted.make(url), ssl: true })

const { handler } = HttpApiBuilder.toWebHandler(
	HttpApiBuilder.api(BudgetApi).pipe(
		Layer.provide(HandlersLayer),
		Layer.provide(DbLayer),
		Layer.merge(HttpServer.layerContext),
	),
)

export default { fetch: handler }

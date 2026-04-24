import { NodeContext } from "@effect/platform-node"
import { PgClient, PgMigrator } from "@effect/sql-pg"
import { fromBabelGlob } from "@effect/sql/Migrator"
import { Effect, Layer, Redacted } from "effect"
import * as _00001 from "../migrations/00001_initial"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL environment variable is required")

const DbLayer = PgClient.layer({ url: Redacted.make(url), ssl: true })
const loader = fromBabelGlob({ _00001_initial: _00001 })

Effect.runPromise(
	Effect.provide(PgMigrator.run({ loader }), Layer.mergeAll(DbLayer, NodeContext.layer)),
)
	.then((results) => {
		if (results.length > 0) {
			console.log("Migrations applied:", results.map(([id, name]) => `${id}_${name}`).join(", "))
		} else {
			console.log("No pending migrations")
		}
		process.exit(0)
	})
	.catch((err) => {
		console.error("Migration failed:", err)
		process.exit(1)
	})

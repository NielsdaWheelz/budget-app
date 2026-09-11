import { BunContext, BunRuntime } from "@effect/platform-bun"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Redacted } from "effect"
import { migrate } from "../migrations"

const url = process.env.DATABASE_URL_UNPOOLED
if (!url) throw new Error("DATABASE_URL_UNPOOLED is required")

migrate.pipe(
	Effect.tap((results) =>
		Effect.log(
			results.length === 0
				? "No pending migrations"
				: `Migrations applied: ${results.map(([id, name]) => `${id}_${name}`).join(", ")}`,
		),
	),
	Effect.provide(
		Layer.mergeAll(PgClient.layer({ url: Redacted.make(url), ssl: true }), BunContext.layer),
	),
	BunRuntime.runMain,
)

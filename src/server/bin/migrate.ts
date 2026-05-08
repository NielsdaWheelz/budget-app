import { BunContext, BunRuntime } from "@effect/platform-bun"
import { PgClient, PgMigrator } from "@effect/sql-pg"
import { fromBabelGlob } from "@effect/sql/Migrator"
import { Effect, Layer, Redacted } from "effect"
import * as _00001 from "../migrations/00001_initial"

const url = process.env.DATABASE_URL_UNPOOLED
if (!url) throw new Error("DATABASE_URL_UNPOOLED is required")

PgMigrator.run({ loader: fromBabelGlob({ _00001_initial: _00001 }) }).pipe(
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

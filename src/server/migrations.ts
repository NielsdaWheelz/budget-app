import { PgMigrator } from "@effect/sql-pg"
import { fromBabelGlob } from "@effect/sql/Migrator"
import * as initial from "./migrations/00001_initial"
import * as history from "./migrations/00002_budget_history"

export const migrate = PgMigrator.run({
	loader: fromBabelGlob({
		_00001_initial: initial,
		_00002_budget_history: history,
	}),
})

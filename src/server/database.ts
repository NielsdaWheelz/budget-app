import { PgClient } from "@effect/sql-pg"
import { SqlError } from "@effect/sql/SqlError"
import { Effect } from "effect"

export function serializable<A, E, R>(effect: Effect.Effect<A, E, R>, readOnly = false) {
	return Effect.gen(function* () {
		const pg = yield* PgClient.PgClient
		return yield* pg.withTransaction(
			Effect.gen(function* () {
				yield* readOnly
					? pg`set transaction isolation level serializable read only`
					: pg`set transaction isolation level serializable`
				return yield* effect
			}),
		)
	}).pipe(
		Effect.retry({
			times: 2,
			while: (error) => {
				if (!(error instanceof SqlError)) return false
				const cause = error.cause
				if (!cause || typeof cause !== "object" || !("code" in cause)) return false
				if (cause.code === "40001" || cause.code === "40P01") return true
				return (
					cause.code === "23505" &&
					"constraint_name" in cause &&
					[
						"users_email_key",
						"planner_templates_user_id_key",
						"month_plans_owner_month",
						"sources_owner_identity",
						"source_items_identity",
						"command_receipts_identity",
					].some((constraint) => constraint === cause.constraint_name)
				)
			},
		}),
		// justify-defect: an exhausted or unrelated database failure cannot establish the promised commit.
		Effect.catchIf(
			(error): error is Extract<typeof error, SqlError> => error instanceof SqlError,
			Effect.die,
		),
	)
}

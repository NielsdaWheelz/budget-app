import { HttpApiBuilder } from "@effect/platform"
import { SqlClient } from "@effect/sql"
import { PgClient } from "@effect/sql-pg"
import { compareSync, hashSync } from "bcryptjs"
import { Effect, Layer, Redacted } from "effect"
import type { BudgetState } from "../shared/schemas.js"
import {
	AuthError,
	AuthMiddleware,
	BudgetApi,
	ConflictError,
	CurrentUser,
	sessionSecurity,
} from "./api.js"

// ---------------------------------------------------------------------------
// Auth middleware implementation
// ---------------------------------------------------------------------------

const AuthMiddlewareLayer = Layer.effect(
	AuthMiddleware,
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return {
			session: (token: Redacted.Redacted) =>
				Effect.gen(function* () {
					const sessionId = Redacted.value(token)
					const rows = yield* sql`
						select s.user_id, u.email
						from sessions s
						join users u on u.id = s.user_id
						where s.id = ${sessionId}
						  and s.expires_at > now()
					`
					if (rows.length === 0) {
						return yield* new AuthError({ message: "Invalid or expired session" })
					}
					const row = rows[0] as { user_id: string; email: string }
					return { userId: row.user_id, email: row.email }
				}).pipe(
					Effect.catchTag(
						"SqlError",
						() => new AuthError({ message: "Authentication service unavailable" }),
					),
				),
		}
	}),
)

// ---------------------------------------------------------------------------
// Auth group handlers
// ---------------------------------------------------------------------------

const AuthGroupLayer = HttpApiBuilder.group(BudgetApi, "auth", (handlers) =>
	handlers
		.handle("register", ({ payload }) =>
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const existing = yield* sql`
					select id from users where email = ${payload.email}
				`.pipe(Effect.orDie)
				if (existing.length > 0) {
					return yield* new ConflictError({
						message: "Email already registered",
					})
				}

				const userId = crypto.randomUUID()
				const hashed = hashSync(payload.password, 10)
				yield* sql`
					insert into users (id, email, password)
					values (${userId}, ${payload.email}, ${hashed})
				`.pipe(Effect.orDie)

				const sessionId = crypto.randomUUID()
				const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
				yield* sql`
					insert into sessions (id, user_id, expires_at)
					values (${sessionId}, ${userId}, ${expiresAt})
				`.pipe(Effect.orDie)

				yield* HttpApiBuilder.securitySetCookie(sessionSecurity, sessionId, {
					httpOnly: true,
					sameSite: "lax",
					path: "/",
					secure: true,
					maxAge: 30 * 24 * 60 * 60,
				})

				return { email: payload.email }
			}),
		)
		.handle("login", ({ payload }) =>
			Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				const users = yield* sql`
					select id, email, password from users where email = ${payload.email}
				`.pipe(Effect.orDie)
				if (users.length === 0) {
					return yield* new AuthError({
						message: "Invalid email or password",
					})
				}

				const user = users[0] as {
					id: string
					email: string
					password: string
				}
				if (!compareSync(payload.password, user.password)) {
					return yield* new AuthError({
						message: "Invalid email or password",
					})
				}

				yield* sql`
					delete from sessions where user_id = ${user.id}
				`.pipe(Effect.orDie)

				const sessionId = crypto.randomUUID()
				const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
				yield* sql`
					insert into sessions (id, user_id, expires_at)
					values (${sessionId}, ${user.id}, ${expiresAt})
				`.pipe(Effect.orDie)

				yield* HttpApiBuilder.securitySetCookie(sessionSecurity, sessionId, {
					httpOnly: true,
					sameSite: "lax",
					path: "/",
					secure: true,
					maxAge: 30 * 24 * 60 * 60,
				})

				return { email: user.email }
			}),
		)
		.handle("logout", () =>
			Effect.gen(function* () {
				const { userId } = yield* CurrentUser
				const sql = yield* SqlClient.SqlClient
				yield* sql`
					delete from sessions where user_id = ${userId}
				`.pipe(Effect.orDie)
				yield* HttpApiBuilder.securitySetCookie(sessionSecurity, "", {
					httpOnly: true,
					sameSite: "lax",
					path: "/",
					secure: true,
					maxAge: 0,
				})
			}),
		),
)

// ---------------------------------------------------------------------------
// Budget group handlers
// ---------------------------------------------------------------------------

const BudgetGroupLayer = HttpApiBuilder.group(BudgetApi, "budget", (handlers) =>
	handlers
		.handle("load", () =>
			Effect.gen(function* () {
				const { userId } = yield* CurrentUser
				const sql = yield* SqlClient.SqlClient
				const rows = yield* sql`
					select state from budgets where user_id = ${userId}
				`.pipe(Effect.orDie)
				if (rows.length === 0) {
					return null
				}
				return (rows[0] as unknown as { state: BudgetState }).state
			}),
		)
		.handle("save", ({ payload }) =>
			Effect.gen(function* () {
				const { userId } = yield* CurrentUser
				const pg = yield* PgClient.PgClient
				yield* pg
					.withTransaction(
						Effect.gen(function* () {
							yield* pg`
								set transaction isolation level serializable
							`
							const existing = yield* pg`
								select id from budgets where user_id = ${userId}
							`
							if (existing.length > 0) {
								yield* pg`
									update budgets
									set state = ${pg.json(payload)}, updated_at = now()
									where user_id = ${userId}
								`
							} else {
								const budgetId = crypto.randomUUID()
								yield* pg`
									insert into budgets (id, user_id, state)
									values (${budgetId}, ${userId}, ${pg.json(payload)})
								`
							}
						}),
					)
					.pipe(Effect.orDie)
			}),
		),
)

// ---------------------------------------------------------------------------
// Self-wired handlers layer
//
// Accepts PgClient | SqlClient and closes it internally.
// Exposes `never` in R — the process layer provides DbLayer.
// ---------------------------------------------------------------------------

export const makeHandlersLayer = <E>(
	dbLayer: Layer.Layer<PgClient.PgClient | SqlClient.SqlClient, E>,
) =>
	Layer.mergeAll(AuthGroupLayer, BudgetGroupLayer).pipe(
		Layer.provide(AuthMiddlewareLayer),
		Layer.provide(dbLayer),
	)

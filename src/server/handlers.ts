import { HttpApiBuilder } from "@effect/platform"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer } from "effect"
import { ConflictError, ForbiddenError, UnauthorizedError } from "../shared/history-errors"
import { BudgetApi } from "./api"
import { AuthMiddlewareLayer, CurrentUser, requireOrigin, setSessionCookie } from "./auth"
import { serializable } from "./database"
import { HistoryHandlersLayer } from "./history-handlers"

const AuthHandlersLayer = HttpApiBuilder.group(BudgetApi, "auth", (handlers) =>
	handlers
		.handle("register", ({ payload }) =>
			Effect.gen(function* () {
				yield* requireOrigin
				const password = yield* Effect.promise(() => Bun.password.hash(payload.password))
				const session = yield* serializable(
					Effect.gen(function* () {
						const pg = yield* PgClient.PgClient
						const existing = yield* pg`select id from users where email = ${payload.email}`
						if (existing.length)
							return yield* new ConflictError({ message: "email already registered" })
						const id = Bun.randomUUIDv7()
						const session = Bun.randomUUIDv7()
						yield* pg`insert into users (id,email,password) values (${id},${payload.email},${password})`
						yield* pg`insert into sessions (id,user_id,expires_at) values (${session},${id},now() + interval '30 days')`
						return session
					}),
				)
				yield* setSessionCookie(session)
				return { email: payload.email }
			}),
		)
		.handle("login", ({ payload }) =>
			Effect.gen(function* () {
				yield* requireOrigin
				const pg = yield* PgClient.PgClient
				const rows = yield* pg<{
					id: string
					email: string
					password: string
				}>`select id,email,password from users where email = ${payload.email}`.pipe(Effect.orDie)
				const user = rows[0]
				if (
					!user ||
					!(yield* Effect.promise(() => Bun.password.verify(payload.password, user.password)))
				) {
					return yield* new UnauthorizedError({ message: "invalid email or password" })
				}
				const session = Bun.randomUUIDv7()
				yield* serializable(
					Effect.gen(function* () {
						yield* pg`delete from sessions where user_id = ${user.id}`
						yield* pg`insert into sessions (id,user_id,expires_at) values (${session},${user.id},now() + interval '30 days')`
					}),
				)
				yield* setSessionCookie(session)
				return { email: user.email }
			}),
		)
		.handle("me", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser
				if (user.scope !== "owner")
					return yield* new ForbiddenError({
						message: "session identity requires a browser session",
					})
				return { email: user.email }
			}),
		)
		.handle("logout", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser
				if (user.scope !== "owner")
					return yield* new ForbiddenError({ message: "logout requires a browser session" })
				yield* serializable(
					Effect.gen(function* () {
						const pg = yield* PgClient.PgClient
						yield* pg`delete from sessions where user_id = ${user.user_id}`
					}),
				)
				yield* setSessionCookie("")
			}),
		),
)

export const HandlersLayer = Layer.mergeAll(AuthHandlersLayer, HistoryHandlersLayer).pipe(
	Layer.provide(AuthMiddlewareLayer),
)

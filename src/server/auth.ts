import { timingSafeEqual } from "node:crypto"
import {
	HttpApiBuilder,
	HttpApiMiddleware,
	HttpApiSecurity,
	HttpServerRequest,
} from "@effect/platform"
import { PgClient } from "@effect/sql-pg"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { ForbiddenError, UnauthorizedError } from "../shared/history-errors"
import type { HistoryActor } from "../shared/history-schemas"

export const AuthenticationConfig = Schema.Struct({
	origin: Schema.String.pipe(
		Schema.filter((value) => {
			try {
				return new URL(value).origin === value
			} catch {
				return false
			}
		}),
	),
	ownerEmail: Schema.NonEmptyString,
	readTokenSha256: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
	writeTokenSha256: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
}).pipe(Schema.filter((value) => value.readTokenSha256 !== value.writeTokenSha256))
export type AuthenticationConfig = typeof AuthenticationConfig.Type

export class Authentication extends Context.Tag("Authentication")<
	Authentication,
	AuthenticationConfig
>() {}
export class CurrentUser extends Context.Tag("CurrentUser")<
	CurrentUser,
	HistoryActor & { readonly email: string }
>() {}

export const sessionSecurity = HttpApiSecurity.apiKey({ key: "session", in: "cookie" })

export class AuthMiddleware extends HttpApiMiddleware.Tag<AuthMiddleware>()("AuthMiddleware", {
	failure: Schema.Union(UnauthorizedError, ForbiddenError),
	provides: CurrentUser,
	security: { bearer: HttpApiSecurity.bearer, session: sessionSecurity },
}) {}

export const requireOrigin = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const config = yield* Authentication
	if (request.headers.origin !== config.origin) {
		return yield* new ForbiddenError({ message: "this request must come from the budget app" })
	}
})

export const AuthMiddlewareLayer = Layer.effect(
	AuthMiddleware,
	Effect.gen(function* () {
		const pg = yield* PgClient.PgClient
		const config = yield* Authentication
		return {
			bearer: (token: Redacted.Redacted) =>
				Effect.gen(function* () {
					const digest = new Bun.CryptoHasher("sha256").update(Redacted.value(token)).digest()
					let scope: "read" | "write"
					if (timingSafeEqual(digest, Buffer.from(config.readTokenSha256, "hex"))) scope = "read"
					else if (timingSafeEqual(digest, Buffer.from(config.writeTokenSha256, "hex")))
						scope = "write"
					else return yield* new UnauthorizedError({ message: "invalid integration credential" })
					const rows = yield* pg<{
						id: string
						email: string
					}>`select id, email from users where email = ${config.ownerEmail}`.pipe(Effect.orDie)
					const user = rows[0]
					if (!user)
						return yield* new UnauthorizedError({ message: "integration owner is not registered" })
					return { user_id: user.id, email: user.email, client: "jarvis" as const, scope }
				}),
			session: (token: Redacted.Redacted) =>
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					if (request.headers.authorization !== undefined) {
						return yield* new UnauthorizedError({ message: "invalid integration credential" })
					}
					if (request.method !== "GET" && request.headers.origin !== config.origin) {
						return yield* new ForbiddenError({
							message: "this request must come from the budget app",
						})
					}
					const rows = yield* pg<{ id: string; email: string }>`
				select u.id, u.email from sessions s join users u on u.id = s.user_id
				where s.id = ${Redacted.value(token)} and s.expires_at > now()
			`.pipe(Effect.orDie)
					const user = rows[0]
					if (!user) return yield* new UnauthorizedError({ message: "invalid or expired session" })
					return {
						user_id: user.id,
						email: user.email,
						client: "browser" as const,
						scope: "owner" as const,
					}
				}),
		}
	}),
)

export const setSessionCookie = (id: string) =>
	HttpApiBuilder.securitySetCookie(sessionSecurity, id, {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		secure: true,
		maxAge: id === "" ? 0 : 30 * 24 * 60 * 60,
	})

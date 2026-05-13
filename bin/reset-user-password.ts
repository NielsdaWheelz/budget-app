import { parseArgs } from "node:util"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { PgClient } from "@effect/sql-pg"
import { Duration, Effect, Layer, Redacted } from "effect"

const usage = `Usage:
  RESET_PASSWORD='new temporary password' bun run bin/reset-user-password.ts --email user@example.com

Required:
  DATABASE_URL_UNPOOLED  Neon direct Postgres connection string
  RESET_PASSWORD         New password, minimum 8 characters
  --email, -e           User email address to reset
`

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		email: { type: "string", short: "e" },
		help: { type: "boolean", short: "h" },
	},
})

if (values.help) {
	console.log(usage)
	process.exit(0)
}

const url = process.env.DATABASE_URL_UNPOOLED
if (!url) throw new Error("DATABASE_URL_UNPOOLED is required")

const email = values.email?.trim().toLowerCase()
if (!email) throw new Error("--email is required")

const password = process.env.RESET_PASSWORD
if (!password || password.length < 8) {
	throw new Error("RESET_PASSWORD is required and must be at least 8 characters")
}

const program = Effect.gen(function* () {
	const pg = yield* PgClient.PgClient
	const hashed = yield* Effect.promise(() => Bun.password.hash(password))
	const updated = yield* pg.withTransaction(
		Effect.gen(function* () {
			const users = yield* pg`
				update users
				set password = ${hashed}
				where email = ${email}
				returning id, email
			`
			if (users.length === 0) {
				return yield* Effect.fail(new Error(`No user found for ${email}`))
			}

			const user = users[0] as { id: string; email: string }
			yield* pg`
				delete from sessions
				where user_id = ${user.id}
			`
			return user
		}),
	)

	yield* Effect.sync(() => {
		console.log(`Password reset for ${updated.email}; existing sessions cleared.`)
	})
})

program.pipe(
	Effect.provide(
		Layer.mergeAll(
			PgClient.layer({
				url: Redacted.make(url),
				ssl: true,
				connectTimeout: Duration.seconds(30),
			}),
			BunContext.layer,
		),
	),
	BunRuntime.runMain,
)

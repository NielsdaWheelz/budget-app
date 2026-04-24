import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* sql`
		create table users (
			id         text        not null primary key,
			email      text        not null unique,
			password   text        not null,
			created_at timestamptz not null default now(),
			extra      jsonb       not null default '{}'::jsonb
		)
	`
	yield* sql`
		create table sessions (
			id         text        not null primary key,
			user_id    text        not null references users(id),
			expires_at timestamptz not null,
			created_at timestamptz not null default now(),
			extra      jsonb       not null default '{}'::jsonb
		)
	`
	yield* sql`
		create table budgets (
			id         text        not null primary key,
			user_id    text        not null unique references users(id),
			state      jsonb       not null,
			updated_at timestamptz not null default now(),
			created_at timestamptz not null default now(),
			extra      jsonb       not null default '{}'::jsonb
		)
	`
})

import { SqlClient } from "@effect/sql"
import { PgClient } from "@effect/sql-pg"
import { Effect, Schema } from "effect"
import { PlannerState } from "../../domain/history"

export default Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	const pg = yield* PgClient.PgClient
	const planners = yield* sql<{ id: string; user_id: string; state: unknown; created_at: string }>`
		select id, user_id, state, created_at::text from budgets
	`
	for (const planner of planners) {
		yield* Schema.decodeUnknown(PlannerState)(planner.state, { onExcessProperty: "error" })
	}
	yield* sql`alter table budgets rename to planner_templates`
	yield* sql`alter table planner_templates drop column updated_at`
	yield* sql`alter table planner_templates rename constraint budgets_user_id_key to planner_templates_user_id_key`
	yield* sql`alter table planner_templates add column revision integer not null default 1`
	yield* sql`create table month_plans (
		id uuid primary key, user_id text not null references users(id), month text not null,
		revision integer not null, adopted_planner_revision integer, lines jsonb not null,
		created_at timestamptz not null default now(), extra jsonb not null default '{}'::jsonb,
		constraint month_plans_owner_month unique(user_id, month)
	)`
	yield* sql`create table transactions (
		id uuid primary key, user_id text not null references users(id), date date not null,
		kind text not null, amount_cents bigint not null, currency text not null, payee text not null,
		note text, payment_reference text, original_expense_id uuid references transactions(id),
		allocations jsonb not null, revision integer not null, voided boolean not null,
		owner_protected boolean not null, created_at timestamptz not null default now(),
		extra jsonb not null default '{}'::jsonb
	)`
	yield* sql`create table sources (
		id uuid primary key, user_id text not null references users(id), namespace text not null,
		external_key text not null, label text not null, media_type text not null,
		original bytea not null, sha256 text not null, external_reference text,
		extraction_complete boolean not null, revision integer not null,
		created_at timestamptz not null default now(), extra jsonb not null default '{}'::jsonb,
		constraint sources_owner_identity unique(user_id, namespace, external_key)
	)`
	yield* sql`create table source_items (
		id uuid primary key, source_id uuid not null references sources(id), item_key text not null,
		revision integer not null, proposal jsonb, review_reason text,
		correction_target_id uuid references transactions(id), resolution text not null,
		accepted_input jsonb, accepted_outcome jsonb, transaction_id uuid references transactions(id),
		created_at timestamptz not null default now(), extra jsonb not null default '{}'::jsonb,
		constraint source_items_identity unique(source_id, item_key)
	)`
	yield* sql`create table changes (
		id uuid primary key, user_id text not null references users(id), entity_kind text not null,
		entity_id text not null, revision integer not null, snapshot jsonb not null, actor jsonb not null,
		reason text, command_key text not null, created_at timestamptz not null default now(),
		extra jsonb not null default '{}'::jsonb,
		constraint changes_entity_revision unique(entity_kind, entity_id, revision)
	)`
	yield* sql`create table command_receipts (
		id uuid primary key, user_id text not null references users(id), client text not null,
		command_key text not null, request_digest text not null, status integer not null, body jsonb not null,
		created_at timestamptz not null default now(), extra jsonb not null default '{}'::jsonb,
		constraint command_receipts_identity unique(user_id, client, command_key)
	)`
	for (const planner of planners) {
		const snapshot = {
			id: planner.id,
			state: planner.state,
			revision: 1,
			created_at: planner.created_at,
		}
		yield* sql`insert into changes (id, user_id, entity_kind, entity_id, revision, snapshot, actor, reason, command_key)
			values (${Bun.randomUUIDv7()}, ${planner.user_id}, 'planner', ${planner.id}, 1,
			${pg.json(snapshot)}, '"migration"'::jsonb, 'migrated existing planner', 'migration:00002')`
	}
})

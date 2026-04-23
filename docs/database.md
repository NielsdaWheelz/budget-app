# Database

## Scope

This document covers PostgreSQL schema rules, query patterns, transaction boundaries, and DB-specific conventions.

## Schema

- Every table has a primary key.
- Primary keys are UUIDv7 `id` values. PostgreSQL v18 supports them natively.
- Do not expose database IDs to users.
- Every table includes `created_at timestamptz not null default now()` and `extra jsonb not null default '{}'::jsonb`.
- Functionality that depends on a database lives in the same module as its migrations.
- Keep database schema rules to storage shape and relational identity: column types, `NOT NULL`, primary keys, foreign keys, and true schema-owned uniqueness.

## Constraints

- Do not add `CHECK` constraints, exclusion constraints, triggers, or other database-enforced business invariant machinery.
- Do not encode domain invariants in database schema, even when they are row-local and easy to express in SQL.
- Examples that still belong in application code plus defects: conditional nullability, tagged-union branch consistency, cross-column correlation, ownership rules, and lifecycle-state rules.
- If you are tempted to add a database constraint for anything richer than storage shape, primary-key identity, foreign-key reachability, or true schema-owned uniqueness, put that invariant in application code instead.

## Foreign Keys

- Use the database's default non-cascading delete behavior.
- Do not use `ON DELETE CASCADE` or other database-level cascading operations.
- Cleanup is explicit in application code.

## Timestamps

- Use `timestamptz` for instants, not `timestamp`.
- Compare against DB-stored timestamps with the same DB family's clock service,
  not the local clock.
- Use `PrimaryDbNow` for rows owned by the primary database and
  `TransientDbNow` for rows owned by the transient coordination database.
- Each database is authoritative for the timestamps it stores.

## Time Intervals

- Time intervals are right-open: `[start, end)`.
- `expires_at` is the first moment of invalidity: active while `now < expires_at`, expired once `now >= expires_at`.
- Use `>` for "active" and `<=` for "expired" when checking expiry against `now()`.

## Indexes

- Do not add indexes speculatively. Add them when a query pattern on a high-volume table needs one.
- Use database uniqueness for true schema-owned keys: primary keys and real local alternate keys.
- Do not use database indexes or unique constraints to encode application-level ownership, correlation, or lifecycle invariants.
- Use application code plus defects for higher-level invariants.

## Query Patterns

- Keep business rules, branching, and fallback policy in TypeScript when reasonably possible.
- Use SQL for database-shaped work such as set filtering, joins, ordering, aggregation, and atomic mutations.
- Do not use `INSERT ... ON CONFLICT` or `.onConflict()` to merge insert and update logic.
- Use an explicit SELECT to check for an existing row, then INSERT, UPDATE, or DELETE accordingly.
- This is safe inside SERIALIZABLE retry transactions — concurrent conflicts cause a serialization failure that triggers a retry.
- The same applies to DELETE. Without an existence check, concurrent deletes can both report success, violating linearization.
- Do not use `numDeletedRows` or `numUpdatedRows` to determine control flow. That is the SELECT's job.
- Assert that row counts match expectations after a mutation as a defect catcher.
- Use `db.runOneOrDie()` for mutations that must affect exactly one row. It defects if the count is not 1.
- Use `db.run()` for bulk operations and mutations where zero results is an expected typed error.
- See [concurrency.md](concurrency.md) for locking rules and [mutation-ordering.md](mutation-ordering.md) for ordering mutations across systems.

## Transaction Boundaries

- `Query.db(...)` and `UnreplayableQuery.db(...)` run SERIALIZABLE read-only transactions. Use `Query.db(...)` when the result must be replay-safe across retries; use `UnreplayableQuery.db(...)` when it does not.
- `SingleMutation.db(...)` runs one replayable SERIALIZABLE write transaction on the primary database. It owns `coordination_primary_txn_memo` crash-recovery caching; callers do not pass replay handles or manually manage txn memo rows.
- `UnreplayableSingleMutation.db(...)` runs one unreplayable SERIALIZABLE write transaction with the same isolation and retry behavior but no replay cache.
- Keep DB transactions scoped to the single atomic database boundary they actually protect. If one SERIALIZABLE commit establishes the invariant, stop there.
- If the real requirement is "this committed step happened, and some later step must also happen eventually", keep the committed DB step in its own transaction and model the follow-up as durable workflow orchestration rather than widening the transaction.
- Transient coordination backends use the transient-local leaf runtimes in `src/framework/coordination/transient/*`, backed by `coordination_transient_txn_memo`.
- `PrimaryDbUnsafeTransaction.run(effect)` and `TransientDbUnsafeTransaction.run(effect)` are the low-level retrying SERIALIZABLE transaction primitives for their respective DB families. They retry on `SqlError` and defect when that retry budget is exhausted.
- Use a family-specific unsafe transaction directly only for simple write boundaries or infrastructure that needs a raw transaction without managed-operation framing.
- Nested DB transactions are not allowed.
- Do not run non-DB side effects inside a DB transaction; they cannot be rolled back on serialization retry.

## DB Helper Composition

- `createDbQueryHelper(...)` composes SQL reads inside `UnreplayableQuery.db(...)`, `SingleMutation.db(...)`, and `UnreplayableSingleMutation.db(...)` bodies.
- `createDbMutationHelper(...)` composes SQL writes inside `SingleMutation.db(...)` and `UnreplayableSingleMutation.db(...)` bodies.
- Raw helpers that need a caller-owned transaction may require `PrimaryDbTransactionScope` or `TransientDbTransactionScope` via `requirePrimaryTransaction(effect)` or `requireTransientTransaction(effect)`.
- Prefer `*.db(...)` boundaries and DB helper constructors over exporting raw transaction-scoped domain helpers.

## Further Reading

- See [operation-types.md](operation-types.md) for managed-operation boundaries and composition rules.
- See [concurrency.md](concurrency.md) for linearization rules.
- See [mutation-ordering.md](mutation-ordering.md) for ordering mutations across systems.
- See [retries.md](retries.md) for retry-boundary rules such as in-memory state not rolling back across retries.

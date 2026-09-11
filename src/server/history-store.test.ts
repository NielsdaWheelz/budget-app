import { afterAll, beforeAll, expect, test } from "bun:test"
import assert from "node:assert/strict"
import type { SqlClient } from "@effect/sql"
import { PgClient } from "@effect/sql-pg"
import { Deferred, Effect, Fiber, Schema } from "effect"
import { startDatabase } from "../../tests/database"
import { BASE_LINE_ITEMS } from "../config/budget-config"
import { PlannerState, TransactionInput } from "../domain/history"
import * as H from "../shared/history-schemas"
import { type MutationContext, historyStore } from "./history-store"
import initialMigration from "./migrations/00001_initial"
import historyMigration from "./migrations/00002_budget_history"

function present<A>(value: A | null | undefined): A {
	assert(value !== null && value !== undefined)
	return value
}

let database: Awaited<ReturnType<typeof startDatabase>>
const owner: H.HistoryActor = { user_id: "owner", client: "browser", scope: "owner" }
const jarvis: H.HistoryActor = { user_id: "owner", client: "jarvis", scope: "write" }
const outsider: H.HistoryActor = { user_id: "other", client: "jarvis", scope: "write" }
const planner = Schema.decodeUnknownSync(PlannerState)({
	grossIncome: 1500000,
	healthInsurance: 100000,
	rentersInsurance: 10000,
	scenarioName: "Solo",
	period: "Monthly",
	lineItemAmounts: Object.fromEntries(BASE_LINE_ITEMS.map((item) => [item.key, item.amount])),
})
const transaction = Schema.decodeUnknownSync(TransactionInput)({
	date: "2026-09-30",
	kind: "expense",
	amount_cents: 51595,
	currency: "USD",
	payee: "grocer",
	note: null,
	payment_reference: null,
	original_expense_id: null,
	allocations: [{ category_key: "Groceries", amount_cents: 51595 }],
})
const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient | SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(database.layer)))
const context = (
	actor: H.HistoryActor,
	key: string,
	target: string,
	_payload: unknown,
): MutationContext => ({ actor, key, method: "POST", target })
const upload = (key: string, body = "paid groceries") =>
	Schema.decodeUnknownSync(H.SourceUpload)({
		expected_revision: null,
		namespace: "gmail:owner@example.com",
		external_key: key,
		label: `${key}.txt`,
		media_type: "text/plain",
		content_base64: Buffer.from(body).toString("base64"),
		external_reference: null,
	})
async function source(key: string) {
	const input = upload(key)
	return (
		await run(
			historyStore.createSource({
				context: context(jarvis, `upload-${key}`, "/sources", input),
				input,
			}),
		)
	).body
}
function recordInput(source: H.SourceRecord, item_key = "purchase") {
	return Schema.decodeUnknownSync(H.ImportCommand)({
		source_id: source.id,
		item_key,
		expected_source_revision: source.revision,
		expected_item_revision: null,
		kind: "record",
		transaction,
	})
}

beforeAll(async () => {
	database = await startDatabase()
	await run(
		Effect.gen(function* () {
			const pg = yield* PgClient.PgClient
			yield* pg.withTransaction(initialMigration)
			yield* pg`insert into users (id,email,password) values ('owner','owner@example.com','unused'),('other','other@example.com','unused')`
			yield* pg`insert into budgets (id,user_id,state) values (${Bun.randomUUIDv7()}, 'owner', ${pg.json(planner)})`
			yield* pg.withTransaction(historyMigration)
		}),
	)
})
afterAll(async () => {
	if (database) await database.close()
})

test("migration preserves the planner and records its original without historical plans", async () => {
	const migrated = await run(historyStore.getPlanner({ actor: owner }))
	expect(migrated?.state).toEqual(planner)
	expect(migrated?.revision).toBe(1)
	const report = await run(historyStore.report({ actor: owner, query: { period: "2026-09" } }))
	expect(report.missing_plan_months.map(String)).toEqual(["2026-09"])
	expect(report.transaction_count).toBe(0)
	const changes = await run(
		historyStore.listChanges({
			actor: owner,
			query: { entity_kind: "planner", entity_id: migrated.id },
		}),
	)
	expect(changes.items.map((item) => item.actor)).toEqual(["migration"])
})

test("concurrent imports, lost responses, and new command keys create one financial fact", async () => {
	const evidence = await source("concurrency")
	const input = recordInput(evidence)
	const request = { context: context(jarvis, "same-import", "/imports", input), input }
	const [first, second] = await Promise.all([
		run(historyStore.importItem(request)),
		run(historyStore.importItem(request)),
	])
	expect(first).toEqual(second)
	const freshKey = await run(
		historyStore.importItem({
			...request,
			context: context(jarvis, "fresh-import-key", "/imports", input),
		}),
	)
	expect(freshKey).toEqual(first)
	const command = await run(historyStore.getCommand({ actor: jarvis, key: "same-import" }))
	expect(command).toEqual(first)
	expect(
		await run(Effect.flip(historyStore.getCommand({ actor: owner, key: "same-import" }))),
	).toMatchObject({ _tag: "NotFoundError" })
	const changed = {
		...input,
		transaction: { ...transaction, payee: "different" },
	} as H.ImportCommand
	expect(
		await run(Effect.flip(historyStore.importItem({ context: request.context, input: changed }))),
	).toMatchObject({ _tag: "ConflictError" })
	const detail = await run(historyStore.getSource({ actor: owner, id: evidence.id }))
	expect(detail.items).toHaveLength(1)
	const audit = await run(
		historyStore.listChanges({
			actor: owner,
			query: { entity_kind: "transaction", entity_id: present(first.body.transaction).id },
		}),
	)
	expect(audit.items).toHaveLength(1)
})

test("owner corrections survive a current-revision importer and stale retries", async () => {
	const evidence = await source("protection")
	const input = recordInput(evidence)
	const original = (
		await run(
			historyStore.importItem({
				context: context(jarvis, "record-protection", "/imports", input),
				input,
			}),
		)
	).body.transaction
	assert(original)
	const update = Schema.decodeUnknownSync(H.TransactionUpdate)({
		expected_revision: 1,
		transaction: { ...transaction, payee: "owner corrected" },
		voided: false,
		reason: "read original",
	})
	const corrected = (
		await run(
			historyStore.updateTransaction({
				context: context(owner, "owner-correction", `/transactions/${original.id}`, update),
				id: original.id,
				input: update,
			}),
		)
	).body
	expect(corrected.owner_protected).toBe(true)
	expect(
		await run(
			Effect.flip(
				historyStore.updateTransaction({
					context: context(owner, "stale-owner-correction", `/transactions/${original.id}`, update),
					id: original.id,
					input: update,
				}),
			),
		),
	).toMatchObject({ _tag: "ConflictError" })
	expect(
		(
			await run(
				historyStore.updateTransaction({
					context: context(owner, "owner-correction", `/transactions/${original.id}`, update),
					id: original.id,
					input: update,
				}),
			)
		).body,
	).toEqual(corrected)
	const attempted = { ...update, expected_revision: corrected.revision }
	expect(
		await run(
			Effect.flip(
				historyStore.updateTransaction({
					context: context(jarvis, "overwrite-owner", `/transactions/${original.id}`, attempted),
					id: original.id,
					input: attempted,
				}),
			),
		),
	).toMatchObject({ _tag: "ForbiddenError" })
	await run(
		historyStore.importItem({
			context: context(jarvis, "record-after-correction", "/imports", input),
			input,
		}),
	)
	expect((await run(historyStore.getTransaction({ actor: owner, id: original.id }))).payee).toBe(
		"owner corrected",
	)
	const voiding = {
		...update,
		expected_revision: corrected.revision,
		voided: true,
		reason: "not personal spending",
	}
	await run(
		historyStore.updateTransaction({
			context: context(owner, "owner-void", `/transactions/${original.id}`, voiding),
			id: original.id,
			input: voiding,
		}),
	)
	await run(
		historyStore.importItem({
			context: context(jarvis, "record-after-void", "/imports", input),
			input,
		}),
	)
	expect((await run(historyStore.getTransaction({ actor: owner, id: original.id }))).voided).toBe(
		true,
	)
	expect(
		await run(Effect.flip(historyStore.getTransaction({ actor: outsider, id: original.id }))),
	).toMatchObject({ _tag: "NotFoundError" })
})

test("owner relinking repairs only evidence and cannot be undone by automated replay", async () => {
	const evidence = await source("relink")
	const input = recordInput(evidence)
	const original = await run(
		historyStore.importItem({
			context: context(jarvis, "relink-original", "/imports", input),
			input,
		}),
	)
	const manual = Schema.decodeUnknownSync(H.TransactionCreate)({
		expected_revision: null,
		transaction: { ...transaction, payee: "correct match" },
	})
	const target = (
		await run(
			historyStore.createTransaction({
				context: context(owner, "relink-target", "/transactions", manual),
				input: manual,
			}),
		)
	).body
	const relink = Schema.decodeUnknownSync(H.ImportCommand)({
		source_id: evidence.id,
		item_key: "purchase",
		expected_source_revision: 1,
		expected_item_revision: 1,
		kind: "relink",
		transaction_id: target.id,
		target_revision: target.revision,
		reason: "matched the wrong purchase",
	})
	const repaired = (
		await run(
			historyStore.importItem({
				context: context(owner, "repair-link", "/imports", relink),
				input: relink,
			}),
		)
	).body
	expect(repaired.item.resolution).toBe("linked")
	expect(repaired.item.transaction_id).toBe(target.id)
	expect(
		(
			await run(
				historyStore.getTransaction({ actor: owner, id: present(original.body.transaction).id }),
			)
		).revision,
	).toBe(1)
	expect((await run(historyStore.getTransaction({ actor: owner, id: target.id }))).revision).toBe(1)
	expect(
		await run(
			historyStore.importItem({
				context: context(jarvis, "relink-original", "/imports", input),
				input,
			}),
		),
	).toEqual(original)
	const latest = { ...input, expected_item_revision: repaired.item.revision }
	expect(
		await run(
			Effect.flip(
				historyStore.importItem({
					context: context(jarvis, "record-after-relink", "/imports", latest),
					input: latest,
				}),
			),
		),
	).toMatchObject({ _tag: "ConflictError" })
	expect(
		(await run(historyStore.getSource({ actor: owner, id: evidence.id }))).items[0]?.transaction_id,
	).toBe(target.id)
})

test("completed sources close new integration items but preserve owner repair and pending resolution", async () => {
	const evidence = await source("completion")
	const complete = { expected_revision: 1 }
	const completed = (
		await run(
			historyStore.completeSource({
				context: context(jarvis, "complete-empty", `/sources/${evidence.id}/complete`, complete),
				id: evidence.id,
				input: complete,
			}),
		)
	).body
	expect(completed.extraction_complete).toBe(true)
	const input = recordInput(completed)
	expect(
		await run(
			Effect.flip(
				historyStore.importItem({
					context: context(jarvis, "closed-new-key", "/imports", input),
					input,
				}),
			),
		),
	).toMatchObject({ _tag: "ConflictError" })
	const ignore = Schema.decodeUnknownSync(H.ImportCommand)({
		source_id: evidence.id,
		item_key: "missed",
		expected_source_revision: 2,
		expected_item_revision: null,
		kind: "ignore",
		reason: "not yet reviewed",
	})
	const ignored = (
		await run(
			historyStore.importItem({
				context: context(owner, "missed-ignore", "/imports", ignore),
				input: ignore,
			}),
		)
	).body
	const reopen = Schema.decodeUnknownSync(H.ImportCommand)({
		source_id: evidence.id,
		item_key: "missed",
		expected_source_revision: 2,
		expected_item_revision: ignored.item.revision,
		kind: "reopen",
		reason: "review again",
		review_reason: "payment_unconfirmed",
	})
	const reopened = (
		await run(
			historyStore.importItem({
				context: context(owner, "reopen-completed", "/imports", reopen),
				input: reopen,
			}),
		)
	).body
	const resolved = { ...input, item_key: "missed", expected_item_revision: reopened.item.revision }
	expect(
		(
			await run(
				historyStore.importItem({
					context: context(jarvis, "resolve-completed", "/imports", resolved),
					input: resolved,
				}),
			)
		).body.status,
	).toBe("recorded")
	expect(
		(await run(historyStore.getSource({ actor: owner, id: evidence.id }))).source.revision,
	).toBe(2)
})

test("a receipt failure rolls back the financial fact, both audits, and the evidence outcome", async () => {
	const evidence = await source("rollback")
	const input = recordInput(evidence)
	const counts = Effect.gen(function* () {
		const pg = yield* PgClient.PgClient
		return yield* pg`select (select count(*) from transactions) as transactions, (select count(*) from changes) as changes`
	})
	const before = await run(counts)
	await run(
		Effect.gen(function* () {
			const pg = yield* PgClient.PgClient
			yield* pg`alter table command_receipts add column injected_failure text not null default 'existing'`
			yield* pg`alter table command_receipts alter column injected_failure drop default`
		}),
	)
	try {
		const exit = await run(
			Effect.exit(
				historyStore.importItem({
					context: context(jarvis, "faulted-record", "/imports", input),
					input,
				}),
			),
		)
		expect(exit._tag).toBe("Failure")
	} finally {
		await run(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				yield* pg`alter table command_receipts drop column injected_failure`
			}),
		)
	}
	expect((await run(historyStore.getSource({ actor: owner, id: evidence.id }))).items).toHaveLength(
		0,
	)
	expect(
		await run(Effect.flip(historyStore.getCommand({ actor: jarvis, key: "faulted-record" }))),
	).toMatchObject({ _tag: "NotFoundError" })
	expect(await run(counts)).toEqual(before)
	const accepted = await run(
		historyStore.importItem({
			context: context(jarvis, "faulted-record", "/imports", input),
			input,
		}),
	)
	expect(accepted.body.item.revision).toBe(1)
	const changes = await run(
		historyStore.listChanges({
			actor: owner,
			query: { entity_kind: "transaction", entity_id: present(accepted.body.transaction).id },
		}),
	)
	expect(changes.items).toHaveLength(1)
})

test("adopted plans stay frozen; reports and paginated category drilldowns share dated facts", async () => {
	const actor: H.HistoryActor = { ...outsider, client: "browser", scope: "owner" }
	const save = Schema.decodeUnknownSync(H.PlannerSave)({ expected_revision: null, state: planner })
	const template = (
		await run(
			historyStore.putPlanner({
				context: context(actor, "save-template", "/planner", save),
				input: save,
			}),
		)
	).body
	const adopt = Schema.decodeUnknownSync(H.MonthPlanSave)({
		kind: "adopt",
		expected_revision: null,
		planner_revision: template.revision,
		reason: null,
	})
	const september = (
		await run(
			historyStore.putPlan({
				context: context(actor, "adopt-september", "/plans/2026-09", adopt),
				month: "2026-09",
				input: adopt,
			}),
		)
	).body
	const expense = Schema.decodeUnknownSync(H.TransactionCreate)({
		expected_revision: null,
		transaction,
	})
	await run(
		historyStore.createTransaction({
			context: context(actor, "dated-expense", "/transactions", expense),
			input: expense,
		}),
	)
	const report = await run(historyStore.report({ actor, query: { period: "2026-09" } }))
	expect(report.rows.find((row) => row.category_key === "Groceries")).toMatchObject({
		planned_cents: 50000,
		recorded_cents: 51595,
		difference_cents: 1595,
	})
	const nextTemplate = Schema.decodeUnknownSync(H.PlannerSave)({
		expected_revision: 1,
		state: { ...planner, lineItemAmounts: { ...planner.lineItemAmounts, Groceries: 60000 } },
	})
	await run(
		historyStore.putPlanner({
			context: context(actor, "change-template", "/planner", nextTemplate),
			input: nextTemplate,
		}),
	)
	expect((await run(historyStore.getPlan({ actor, month: "2026-09" }))).lines).toEqual(
		september.lines,
	)
	const amendment = Schema.decodeUnknownSync(H.MonthPlanSave)({
		kind: "explicit",
		expected_revision: 1,
		lines: september.lines.map((line) =>
			line.category_key === "Groceries" ? { ...line, planned_cents: 55000 } : line,
		),
		reason: "one extra shopping trip",
	})
	await run(
		historyStore.putPlan({
			context: context(actor, "amend-september", "/plans/2026-09", amendment),
			month: "2026-09",
			input: amendment,
		}),
	)
	const changes = await run(
		historyStore.listChanges({
			actor,
			query: { entity_kind: "plan", entity_id: september.id, limit: 1 },
		}),
	)
	expect(changes.items[0]?.revision).toBe(2)
	expect(changes.next_cursor).not.toBeNull()
	const original = await run(
		historyStore.listChanges({
			actor,
			query: {
				entity_kind: "plan",
				entity_id: september.id,
				limit: 1,
				cursor: present(changes.next_cursor),
			},
		}),
	)
	expect(original.items[0]?.snapshot).toEqual(september)
	const split = Schema.decodeUnknownSync(H.TransactionCreate)({
		expected_revision: null,
		transaction: {
			...transaction,
			amount_cents: 10000,
			allocations: [
				{ category_key: "Groceries", amount_cents: 9000 },
				{ category_key: "DiningOut", amount_cents: 1000 },
			],
		},
	})
	await run(
		historyStore.createTransaction({
			context: context(actor, "split-expense", "/transactions", split),
			input: split,
		}),
	)
	const query = Schema.decodeUnknownSync(H.TransactionListQuery)({
		from: "2026-09-01",
		until: "2026-10-01",
		category: "Groceries",
		limit: "1",
	})
	const first = await run(historyStore.listTransactions({ actor, query }))
	expect(first.items[0]).toMatchObject({ amount_cents: 10000, contribution_cents: 9000 })
	const second = await run(
		historyStore.listTransactions({
			actor,
			query: { ...query, cursor: present(first.next_cursor) },
		}),
	)
	expect(second.items[0]).toMatchObject({ amount_cents: 51595, contribution_cents: 51595 })
	expect(second.next_cursor).toBeNull()
	const finalReport = await run(historyStore.report({ actor, query: { period: "2026-09" } }))
	expect(
		finalReport.rows.find((row) => row.category_key === "Groceries")?.recorded_cents as number,
	).toBe(60595)
})

test("source identity preserves bytes and separate identical purchases remain separate", async () => {
	const evidence = await source("source-identity")
	const repeated = upload("source-identity")
	expect(
		(
			await run(
				historyStore.createSource({
					context: context(jarvis, "source-again", "/sources", repeated),
					input: repeated,
				}),
			)
		).body.id,
	).toBe(evidence.id)
	const changed = upload("source-identity", "different original")
	expect(
		await run(
			Effect.flip(
				historyStore.createSource({
					context: context(jarvis, "source-different", "/sources", changed),
					input: changed,
				}),
			),
		),
	).toMatchObject({ _tag: "ConflictError" })
	const separate = await source("source-distinct")
	expect(separate.id).not.toBe(evidence.id)
	expect(separate.sha256).toBe(evidence.sha256)
	expect(
		Buffer.from(
			(await run(historyStore.getSourceContent({ actor: owner, id: evidence.id }))).original,
		).toString(),
	).toBe("paid groceries")
	const firstInput = recordInput(evidence)
	const secondInput = recordInput(separate)
	const first = (
		await run(
			historyStore.importItem({
				context: context(jarvis, "first-purchase", "/imports", firstInput),
				input: firstInput,
			}),
		)
	).body
	const second = (
		await run(
			historyStore.importItem({
				context: context(jarvis, "second-purchase", "/imports", secondInput),
				input: secondInput,
			}),
		)
	).body
	expect(first.transaction?.id).not.toBe(second.transaction?.id)
	const supporting = await run(
		historyStore.listSources({
			actor: owner,
			query: { transaction_id: present(first.transaction).id },
		}),
	)
	expect(supporting.items.map((item) => item.id)).toEqual([evidence.id])
})

test("migration aborts invalid legacy state without renaming or fabricating data", async () => {
	await run(
		Effect.gen(function* () {
			const pg = yield* PgClient.PgClient
			yield* pg`create database invalid_history`
		}),
	)
	const layer = PgClient.layer({ ...database.config, database: "invalid_history" })
	await Effect.runPromise(
		Effect.gen(function* () {
			const pg = yield* PgClient.PgClient
			yield* pg.withTransaction(initialMigration)
			yield* pg`insert into users (id,email,password) values ('legacy','legacy@example.com','unused')`
			const invalid = { ...planner, grossIncome: -1 }
			yield* pg`insert into budgets (id,user_id,state) values (${Bun.randomUUIDv7()}, 'legacy', ${pg.json(invalid)})`
			const result = yield* Effect.exit(pg.withTransaction(historyMigration))
			expect(result._tag).toBe("Failure")
			const state = yield* pg<{ state: unknown }>`select state from budgets`
			expect(state[0]?.state).toEqual(invalid)
			const tables = yield* pg<{
				name: string | null
			}>`select to_regclass('public.month_plans')::text as name`
			expect(tables[0]?.name).toBeNull()
		}).pipe(Effect.provide(layer)),
	)
})

test("partial correction observations cannot create another expense or change target without the owner", async () => {
	const evidence = await source("correction-review")
	const create = Schema.decodeUnknownSync(H.TransactionCreate)({
		expected_revision: null,
		transaction,
	})
	const target = (
		await run(
			historyStore.createTransaction({
				context: context(owner, "correction-target", "/transactions", create),
				input: create,
			}),
		)
	).body
	const other = (
		await run(
			historyStore.createTransaction({
				context: context(owner, "other-correction-target", "/transactions", create),
				input: create,
			}),
		)
	).body
	const hold = Schema.decodeUnknownSync(H.ImportCommand)({
		source_id: evidence.id,
		item_key: "purchase",
		expected_source_revision: 1,
		expected_item_revision: null,
		kind: "hold",
		proposal: { currency: "EUR", amount_cents: "unreadable" },
		reason: "correction_conflict",
		correction_target_id: target.id,
	})
	const pending = (
		await run(
			historyStore.importItem({
				context: context(jarvis, "hold-correction", "/imports", hold),
				input: hold,
			}),
		)
	).body
	expect(pending.item.proposal).toEqual({ currency: "EUR", amount_cents: "unreadable" })
	const record = { ...recordInput(evidence), expected_item_revision: pending.item.revision }
	expect(
		await run(
			Effect.flip(
				historyStore.importItem({
					context: context(owner, "duplicate-correction", "/imports", record),
					input: record,
				}),
			),
		),
	).toMatchObject({ _tag: "ConflictError" })
	const retarget = {
		...hold,
		expected_item_revision: pending.item.revision,
		correction_target_id: other.id,
	}
	expect(
		await run(
			Effect.flip(
				historyStore.importItem({
					context: context(jarvis, "retarget-correction", "/imports", retarget),
					input: retarget,
				}),
			),
		),
	).toMatchObject({ _tag: "ForbiddenError" })
	const reviewed = (
		await run(
			historyStore.importItem({
				context: context(owner, "owner-retarget", "/imports", retarget),
				input: retarget,
			}),
		)
	).body
	const link = Schema.decodeUnknownSync(H.ImportCommand)({
		source_id: evidence.id,
		item_key: "purchase",
		expected_source_revision: 1,
		expected_item_revision: reviewed.item.revision,
		kind: "link",
		transaction_id: other.id,
		target_revision: other.revision,
	})
	const linked = (
		await run(
			historyStore.importItem({
				context: context(jarvis, "link-reviewed-correction", "/imports", link),
				input: link,
			}),
		)
	).body
	expect(linked.item.resolution).toBe("linked")
	expect(linked.transaction?.owner_protected).toBe(true)
	expect(linked.transaction?.revision).toBe(1)
})

test("migration validates and audits the latest planner after an in-flight legacy write", async () => {
	await run(
		Effect.gen(function* () {
			const pg = yield* PgClient.PgClient
			yield* pg`create database migration_lock_test`
		}),
	)
	const layer = PgClient.layer({ ...database.config, database: "migration_lock_test" })
	await Effect.runPromise(
		Effect.gen(function* () {
			const pg = yield* PgClient.PgClient
			yield* pg.withTransaction(initialMigration)
			yield* pg`insert into users (id,email,password) values ('legacy-race','race@example.test','unused')`
			yield* pg`insert into budgets (id,user_id,state) values (${Bun.randomUUIDv7()}, 'legacy-race', ${pg.json(planner)})`
			const updated = { ...planner, grossIncome: 1750000 }
			const writerReady = yield* Deferred.make<void>()
			const releaseWriter = yield* Deferred.make<void>()
			const writer = yield* Effect.fork(
				pg.withTransaction(
					Effect.gen(function* () {
						yield* pg`update budgets set state = ${pg.json(updated)} where user_id = 'legacy-race'`
						yield* Deferred.succeed(writerReady, undefined)
						yield* Deferred.await(releaseWriter)
					}),
				),
			)
			yield* Deferred.await(writerReady)
			const migration = yield* Effect.fork(pg.withTransaction(historyMigration))
			try {
				let waiting = false
				for (let attempt = 0; attempt < 200 && !waiting; attempt++) {
					const rows =
						yield* pg`select pid from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
					waiting = rows.length > 0
				}
				expect(waiting).toBe(true)
			} finally {
				yield* Deferred.succeed(releaseWriter, undefined)
			}
			yield* Fiber.join(writer)
			yield* Fiber.join(migration)
			const rows = yield* pg<{ state: unknown; snapshot: { state: unknown } }>`
			select p.state, c.snapshot from planner_templates p join changes c on c.entity_id = p.id and c.entity_kind = 'planner'
			where p.user_id = 'legacy-race'
		`
			expect(rows[0]?.state).toEqual(updated)
			expect(rows[0]?.snapshot.state).toEqual(updated)
		}).pipe(Effect.provide(layer)),
	)
})

import { expect, test } from "bun:test"
import { join } from "node:path"
import { BunContext } from "@effect/platform-bun"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, Schema } from "effect"
import { historyStore } from "../src/server/history-store"
import { migrate } from "../src/server/migrations"
import * as H from "../src/shared/history-schemas"
import { startDatabase } from "./database"

test("the real migration runner and a restored backup preserve original evidence, history, and replay", async () => {
	const db = await startDatabase()
	try {
		const run = <A, E, R, LE>(effect: Effect.Effect<A, E, R>, layer: Layer.Layer<R, LE>) =>
			Effect.runPromise(effect.pipe(Effect.provide(layer)))
		const migrations = await Effect.runPromise(
			migrate.pipe(Effect.provide(Layer.mergeAll(db.layer, BunContext.layer))),
		)
		expect(migrations.map(([number]) => number)).toEqual([1, 2])
		const actor: H.HistoryActor = { user_id: "recovery-owner", client: "jarvis", scope: "write" }
		await run(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				yield* pg`insert into users(id,email,password) values (${actor.user_id},'recovery@example.test','unused')`
			}),
			db.layer,
		)
		const bytes = Buffer.from("paid receipt: 15.95 usd\n")
		const source = (
			await run(
				historyStore.createSource({
					context: { actor, key: "receipt-upload", method: "POST", target: "/api/sources" },
					input: Schema.decodeUnknownSync(H.SourceUpload)({
						expected_revision: null,
						namespace: "recovery",
						external_key: "receipt",
						label: "receipt.txt",
						media_type: "text/plain",
						content_base64: bytes.toString("base64"),
						external_reference: null,
					}),
				}),
				db.layer,
			)
		).body
		const input = Schema.decodeUnknownSync(H.ImportCommand)({
			source_id: source.id,
			item_key: "purchase",
			expected_source_revision: 1,
			expected_item_revision: null,
			kind: "record",
			transaction: {
				date: "2026-09-11",
				kind: "expense",
				amount_cents: 1595,
				currency: "USD",
				payee: "market",
				note: null,
				payment_reference: null,
				original_expense_id: null,
				allocations: [{ category_key: "Groceries", amount_cents: 1595 }],
			},
		})
		const context = { actor, key: "receipt-record", method: "POST", target: "/api/imports" }
		const original = await run(historyStore.importItem({ context, input }), db.layer)
		const dump = join(db.directory, "backup.dump")
		let process = Bun.spawn(
			[
				join(db.bindir, "pg_dump"),
				"--format=custom",
				"--no-owner",
				"--file",
				dump,
				"--dbname",
				db.url,
			],
			{ stdout: "pipe", stderr: "pipe" },
		)
		expect(await process.exited).toBe(0)
		await run(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				yield* pg`create database budget_restore_test`
			}),
			db.layer,
		)
		process = Bun.spawn(
			[
				join(db.bindir, "pg_restore"),
				"--no-owner",
				"--dbname",
				db.url.replace(/\/postgres$/, "/budget_restore_test"),
				dump,
			],
			{ stdout: "pipe", stderr: "pipe" },
		)
		expect(await process.exited).toBe(0)
		const restored = PgClient.layer({ ...db.config, database: "budget_restore_test" })
		const downloaded = await run(historyStore.getSourceContent({ actor, id: source.id }), restored)
		expect(Buffer.from(downloaded.original)).toEqual(bytes)
		const evidence = await run(historyStore.getSource({ actor, id: source.id }), restored)
		expect(evidence.source.sha256).toBe(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"))
		expect(evidence.items[0]?.transaction_id).toBe(original.body.transaction?.id)
		expect(await run(historyStore.getCommand({ actor, key: context.key }), restored)).toEqual(
			original,
		)
		expect(await run(historyStore.importItem({ context, input }), restored)).toEqual(original)
		const transactions = await run(historyStore.listTransactions({ actor, query: {} }), restored)
		expect(transactions.items.map((transaction) => Number(transaction.amount_cents))).toEqual([
			1595,
		])
		const transaction = transactions.items[0]
		if (!transaction) throw new Error("restored transaction missing")
		const audit = await run(
			historyStore.listChanges({
				actor,
				query: { entity_kind: "transaction", entity_id: transaction.id },
			}),
			restored,
		)
		expect(audit.items.map((change) => change.revision)).toEqual([1])
	} finally {
		await db.close()
	}
}, 15000)

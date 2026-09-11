import { afterAll, beforeAll, expect, test } from "bun:test"
import type { SqlClient } from "@effect/sql"
import { PgClient } from "@effect/sql-pg"
import { Effect, Schema } from "effect"
import { BASE_LINE_ITEMS } from "../src/config/budget-config"
import { HistoryReport, PlannerState, TransactionInput } from "../src/domain/history"
import { makeApp } from "../src/server/app"
import initialMigration from "../src/server/migrations/00001_initial"
import historyMigration from "../src/server/migrations/00002_budget_history"
import * as H from "../src/shared/history-schemas"
import { AuthResult } from "../src/shared/schemas"
import { startDatabase } from "./database"

const origin = "https://budget.test"
const readToken = crypto.randomUUID()
const writeToken = crypto.randomUUID()
const digest = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex")
const originalBytes = Buffer.from("%PDF-1.7\nreceipt evidence\n\xff\x00", "binary")
const input = Schema.decodeUnknownSync(TransactionInput)({
	date: "2026-09-11",
	kind: "expense",
	amount_cents: 1234,
	currency: "USD",
	payee: "market",
	note: null,
	payment_reference: null,
	original_expense_id: null,
	allocations: [{ category_key: "Groceries", amount_cents: 1234 }],
})
const plannerState = Schema.decodeUnknownSync(PlannerState)({
	grossIncome: 1500000,
	healthInsurance: 100000,
	rentersInsurance: 10000,
	scenarioName: "Solo",
	period: "Monthly",
	lineItemAmounts: Object.fromEntries(BASE_LINE_ITEMS.map((item) => [item.key, item.amount])),
})
let database: Awaited<ReturnType<typeof startDatabase>>
let app: ReturnType<typeof makeApp>
let ownerCookie: string
let outsiderCookie: string
let source: H.SourceRecord
let imported: H.TransactionRecord
let manual: H.TransactionRecord
let savedPlanner: H.PlannerRecord

const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient | SqlClient.SqlClient>) =>
	Effect.runPromise(effect.pipe(Effect.provide(database.layer)))

const send = (
	path: string,
	options: {
		method?: string
		cookie?: string
		token?: string
		body?: unknown
		key?: string
		origin?: string | null
	} = {},
) => {
	const headers = new Headers()
	if (options.cookie !== undefined) headers.set("cookie", options.cookie)
	if (options.token !== undefined) headers.set("authorization", `Bearer ${options.token}`)
	if (options.origin !== null) headers.set("origin", options.origin ?? origin)
	if (options.body !== undefined) headers.set("content-type", "application/json")
	if (options.method && options.method !== "GET")
		headers.set("idempotency-key", options.key ?? crypto.randomUUID())
	return app.fetch(
		new Request(`${origin}/api${path}`, {
			method: options.method ?? "GET",
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		}),
	)
}

const decoded = async <S extends Schema.Schema.AnyNoContext>(
	schema: S,
	response: Response,
): Promise<S["Type"]> => {
	const value: unknown = await response.json()
	expect({ status: response.status, ...(response.status === 200 ? {} : { body: value }) }).toEqual({
		status: 200,
	})
	return Schema.decodeUnknownSync(schema)(value)
}

const register = async (email: string) => {
	const response = await send("/auth/register", {
		method: "POST",
		body: { email, password: "synthetic-test-password" },
	})
	await decoded(AuthResult, response)
	const cookie = response.headers.get("set-cookie")?.split(";")[0]
	if (!cookie) throw new Error("registration did not issue its session cookie")
	return cookie
}

beforeAll(async () => {
	database = await startDatabase()
	await run(
		Effect.gen(function* () {
			const pg = yield* PgClient.PgClient
			yield* pg.withTransaction(initialMigration)
			yield* pg.withTransaction(historyMigration)
		}),
	)
	app = makeApp({
		database: database.config,
		authentication: {
			origin,
			ownerEmail: "owner@example.test",
			readTokenSha256: digest(readToken),
			writeTokenSha256: digest(writeToken),
		},
	})
	ownerCookie = await register("owner@example.test")
	outsiderCookie = await register("outsider@example.test")
	savedPlanner = await decoded(
		H.PlannerRecord,
		await send("/planner", {
			method: "PUT",
			cookie: ownerCookie,
			key: "owner-planner",
			body: Schema.decodeUnknownSync(H.PlannerSave)({
				expected_revision: null,
				state: plannerState,
			}),
		}),
	)
	source = await decoded(
		H.SourceRecord,
		await send("/sources", {
			method: "POST",
			token: writeToken,
			body: Schema.decodeUnknownSync(H.SourceUpload)({
				expected_revision: null,
				namespace: "test-mail/owner",
				external_key: "receipt",
				label: "owner's (paid)*.pdf",
				media_type: "application/pdf",
				content_base64: originalBytes.toString("base64"),
				external_reference: null,
			}),
		}),
	)
	const result = await decoded(
		H.ImportResult,
		await send("/imports", {
			method: "POST",
			token: writeToken,
			body: Schema.decodeUnknownSync(H.ImportCommand)({
				source_id: source.id,
				item_key: "purchase",
				expected_source_revision: 1,
				expected_item_revision: null,
				kind: "record",
				transaction: input,
			}),
		}),
	)
	if (!result.transaction) throw new Error("accepted import did not return a transaction")
	imported = result.transaction
	manual = await decoded(
		H.TransactionRecord,
		await send("/transactions", {
			method: "POST",
			cookie: ownerCookie,
			body: Schema.decodeUnknownSync(H.TransactionCreate)({
				expected_revision: null,
				transaction: input,
			}),
		}),
	)
})

afterAll(async () => {
	if (app) await app.dispose()
	if (database) await database.close()
})

test("both clients read schema-valid state while unauthenticated requests fail", async () => {
	expect((await send("/catalog")).status).toBe(401)
	const catalog = await decoded(H.HistoryCatalog, await send("/catalog", { token: readToken }))
	expect(catalog.currency).toBe("USD")
	await decoded(H.PlannerRecord, await send("/planner", { cookie: ownerCookie }))
	await decoded(H.TransactionPage, await send("/transactions?limit=1", { token: readToken }))
	await decoded(HistoryReport, await send("/reports?period=2026-09", { token: readToken }))
	expect((await send("/plans/2026-01", { cookie: ownerCookie })).status).toBe(404)
})

test("integration scopes prevent manual creation, plan writes, voiding, and protected edits", async () => {
	const save = { expected_revision: savedPlanner.revision, state: plannerState }
	for (const token of [readToken, writeToken]) {
		expect((await send("/planner", { method: "PUT", token, body: save })).status).toBe(403)
		expect(
			(
				await send("/transactions", {
					method: "POST",
					token,
					body: { expected_revision: null, transaction: input },
				})
			).status,
		).toBe(403)
	}
	expect(
		(
			await send("/sources", {
				method: "POST",
				token: readToken,
				body: {
					expected_revision: null,
					namespace: "test-mail/owner",
					external_key: "read-denied",
					label: "read-denied.txt",
					media_type: "text/plain",
					content_base64: "YQ==",
					external_reference: null,
				},
			})
		).status,
	).toBe(403)
	expect(
		(
			await send("/plans/2026-09", {
				method: "PUT",
				token: writeToken,
				body: {
					kind: "adopt",
					expected_revision: null,
					planner_revision: savedPlanner.revision,
					reason: null,
				},
			})
		).status,
	).toBe(403)
	expect(
		(
			await send(`/transactions/${imported.id}`, {
				method: "PUT",
				token: writeToken,
				body: {
					expected_revision: imported.revision,
					transaction: input,
					voided: true,
					reason: "not permitted",
				},
			})
		).status,
	).toBe(403)
	expect(
		(
			await send(`/transactions/${manual.id}`, {
				method: "PUT",
				token: writeToken,
				body: {
					expected_revision: manual.revision,
					transaction: input,
					voided: false,
					reason: "not permitted",
				},
			})
		).status,
	).toBe(403)
	const preserved = await decoded(
		H.TransactionRecord,
		await send(`/transactions/${imported.id}`, { token: readToken }),
	)
	expect(preserved.revision).toBe(1)
})

test("cookies cannot elevate bearer credentials and cookie writes require the configured origin", async () => {
	expect(
		(await send("/catalog", { token: "invalid-credential", cookie: ownerCookie })).status,
	).toBe(401)
	expect(
		(
			await send("/planner", {
				method: "PUT",
				token: readToken,
				cookie: ownerCookie,
				body: { expected_revision: 1, state: plannerState },
			})
		).status,
	).toBe(403)
	for (const requestOrigin of [null, "https://foreign.example"]) {
		expect(
			(
				await send("/transactions", {
					method: "POST",
					cookie: ownerCookie,
					origin: requestOrigin,
					body: { expected_revision: null, transaction: input },
				})
			).status,
		).toBe(403)
	}
})

test("originals remain exact authenticated downloads and cannot leak across owners", async () => {
	const response = await send(`/sources/${source.id}/content`, { token: readToken })
	expect(response.status).toBe(200)
	expect(Buffer.from(await response.arrayBuffer())).toEqual(originalBytes)
	expect(response.headers.get("content-disposition")).toBe(
		"attachment; filename*=UTF-8''owner%27s%20%28paid%29%2A.pdf",
	)
	expect(response.headers.get("x-content-type-options")).toBe("nosniff")
	const sources = await decoded(
		H.SourcePage,
		await send(`/sources?transaction_id=${imported.id}`, { cookie: ownerCookie }),
	)
	expect(sources.items.map((item) => item.id)).toContain(source.id)
	for (const path of [
		`/transactions/${imported.id}`,
		`/sources/${source.id}`,
		`/sources/${source.id}/content`,
		"/commands/owner-planner",
	]) {
		expect((await send(path, { cookie: outsiderCookie })).status).toBe(404)
	}
	const changes = await decoded(
		H.ChangePage,
		await send(`/changes?entity_kind=transaction&entity_id=${imported.id}`, {
			cookie: outsiderCookie,
		}),
	)
	expect(changes.items).toHaveLength(0)
})

test("strict body, path, and query validation is distinct from malformed json", async () => {
	for (const body of [
		{ expected_revision: null, transaction: input, owner_protected: false },
		{ expected_revision: null, transaction: { ...input, amount_cents: 12.34 } },
		{ expected_revision: null, transaction: { ...input, currency: "EUR" } },
	])
		expect(
			(await send("/transactions", { method: "POST", cookie: ownerCookie, body })).status,
		).toBe(422)
	for (const path of [
		"/transactions/not-an-id",
		"/reports?period=2026-13",
		"/reports?period=2026-09&through_month=1",
		"/transactions?limit=101",
	]) {
		expect((await send(path, { cookie: ownerCookie })).status).toBe(422)
	}
	const malformed = await app.fetch(
		new Request(`${origin}/api/transactions`, {
			method: "POST",
			headers: {
				cookie: ownerCookie,
				origin,
				"content-type": "application/json",
				"idempotency-key": "malformed",
			},
			body: "{",
		}),
	)
	expect(malformed.status).toBe(400)
	const encoded = Buffer.from(
		JSON.stringify({ expected_revision: null, transaction: { ...input, payee: "invalid-utf8" } }),
	)
	encoded[encoded.indexOf("invalid-utf8")] = 0xff
	const invalidUtf8 = await app.fetch(
		new Request(`${origin}/api/transactions`, {
			method: "POST",
			headers: {
				cookie: ownerCookie,
				origin,
				"content-type": "application/json",
				"idempotency-key": "invalid-utf8",
			},
			body: encoded,
		}),
	)
	expect(invalidUtf8.status).toBe(400)
	const unchanged = await decoded(
		H.TransactionPage,
		await send("/transactions?payee=utf8", { token: readToken }),
	)
	expect(unchanged.items).toHaveLength(0)
})

test("source and request size limits return 413 without creating a source", async () => {
	const oversize = await send("/sources", {
		method: "POST",
		token: writeToken,
		body: {
			expected_revision: null,
			namespace: "test-mail/owner",
			external_key: "oversize",
			label: "large.txt",
			media_type: "text/plain",
			external_reference: null,
			content_base64: Buffer.alloc(H.MAX_SOURCE_BYTES + 1, 97).toString("base64"),
		},
	})
	expect(oversize.status).toBe(413)
	const request = await app.fetch(
		new Request(`${origin}/api/sources`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${writeToken}`,
				"content-type": "application/json",
				"idempotency-key": "oversize-request",
			},
			body: " ".repeat(H.MAX_REQUEST_BYTES + 1),
		}),
	)
	expect(request.status).toBe(413)
	const sources = await decoded(
		H.SourcePage,
		await send("/sources?external_key=oversize", { token: readToken }),
	)
	expect(sources.items).toHaveLength(0)
})

test("a database outage returns a generic 500 rather than empty financial history", async () => {
	await run(
		Effect.gen(function* () {
			const pg = yield* PgClient.PgClient
			yield* pg`alter table transactions rename to unavailable_http_transactions`
		}),
	)
	try {
		const response = await send("/transactions", { token: readToken })
		expect(response.status).toBe(500)
		const body = await response.text()
		for (const secret of [
			readToken,
			writeToken,
			"unavailable_http_transactions",
			"SELECT",
			"postgres://",
		])
			expect(body).not.toContain(secret)
	} finally {
		await run(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				yield* pg`alter table unavailable_http_transactions rename to transactions`
			}),
		)
	}
	await decoded(H.TransactionPage, await send("/transactions", { token: readToken }))
})

test("a cold database outage returns 500 and the same app recovers when storage is ready", async () => {
	// The platform caches middleware by tag; a separate process models one deployed app.
	const child = Bun.spawn(
		[
			"bun",
			"-e",
			String.raw`
				import assert from "node:assert/strict"
				import { PgClient } from "@effect/sql-pg"
				import { Effect, Schema } from "effect"
				import { makeApp } from "./src/server/app.ts"
				import initialMigration from "./src/server/migrations/00001_initial.ts"
				import historyMigration from "./src/server/migrations/00002_budget_history.ts"
				import { HistoryCatalog } from "./src/shared/history-schemas.ts"
				const database = JSON.parse(process.env.HTTP_TEST_DATABASE)
				const storage = { ...database, database: "http_cold_recovery" }
				const origin = "https://cold-budget.test"
				const token = crypto.randomUUID()
				const digest = (value) => new Bun.CryptoHasher("sha256").update(value).digest("hex")
				const app = makeApp({ database: storage, authentication: {
					origin, ownerEmail: "cold-owner@example.test",
					readTokenSha256: digest(token), writeTokenSha256: digest(crypto.randomUUID()),
				} })
				const catalog = () => app.fetch(new Request(origin + "/api/catalog", {
					headers: { authorization: "Bearer " + token },
				}))
				try {
					const unavailable = await catalog()
					assert.equal(unavailable.status, 500)
					assert.equal(unavailable.headers.get("cache-control"), "no-store")
					assert.deepEqual(await unavailable.json(), {
						_tag: "ServerError", message: "the server could not complete this request",
					})
					await Effect.runPromise(Effect.gen(function* () {
						const pg = yield* PgClient.PgClient
						yield* pg.unsafe("create database http_cold_recovery")
					}).pipe(Effect.provide(PgClient.layer(database))))
					await Effect.runPromise(Effect.gen(function* () {
						const pg = yield* PgClient.PgClient
						yield* pg.withTransaction(initialMigration)
						yield* pg.withTransaction(historyMigration)
					}).pipe(Effect.provide(PgClient.layer(storage))))
					const registration = await app.fetch(new Request(origin + "/api/auth/register", {
						method: "POST", headers: { origin, "content-type": "application/json" },
						body: JSON.stringify({ email: "cold-owner@example.test", password: "synthetic-test-password" }),
					}))
					assert.equal(registration.status, 200)
					const restored = await catalog()
					assert.equal(restored.status, 200)
					assert.equal(Schema.decodeUnknownSync(HistoryCatalog)(await restored.json()).currency, "USD")
					console.log("cold 500; recovered 200")
				} finally {
					await app.dispose()
				}
			`,
		],
		{
			cwd: `${import.meta.dir}/..`,
			env: { ...process.env, HTTP_TEST_DATABASE: JSON.stringify(database.config) },
			stdout: "pipe",
			stderr: "pipe",
		},
	)
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	])
	expect({ code, ...(code === 0 ? {} : { stderr }) }).toEqual({ code: 0 })
	expect(stderr).not.toContain("http_cold_recovery")
	expect(stdout).toContain("cold 500; recovered 200")
})

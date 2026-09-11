import { PgClient } from "@effect/sql-pg"
import type { SqlError } from "@effect/sql/SqlError"
import { Effect, Schema } from "effect"
import {
	CalendarDate,
	CalendarMonth,
	PlannerState,
	TransactionInput,
	buildReport,
	reportRange,
	snapshotPlan,
	transactionContribution,
} from "../domain/history"
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	TooLargeError,
	ValidationError,
} from "../shared/history-errors"
import * as H from "../shared/history-schemas"
import { serializable } from "./database"

export interface MutationContext {
	readonly actor: H.HistoryActor
	readonly key: string
	readonly method: string
	readonly target: string
}

type Failure = ConflictError | ForbiddenError | NotFoundError | TooLargeError | ValidationError
export interface MutationResult<A> {
	readonly status: number
	readonly body: A
}
type DbEffect<A> = Effect.Effect<A, Failure | SqlError, PgClient.PgClient>

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
			.join(",")}}`
	}
	const encoded = JSON.stringify(value)
	if (encoded === undefined) throw new Error("canonical command input must be json")
	return encoded
}

function normalized(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalized)
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, v]) => v !== undefined)
				.map(([k, v]) => [
					k,
					(k === "allocations" || k === "lines") && Array.isArray(v)
						? v
								.map(normalized)
								.sort((a, b) =>
									canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0,
								)
						: normalized(v),
				]),
		)
	}
	return value
}

function validate<A, I>(schema: Schema.Schema<A, I>, value: unknown) {
	return Schema.decodeUnknown(schema)(value, { onExcessProperty: "error" }).pipe(
		Effect.mapError((error) => new ValidationError({ message: String(error) })),
	)
}

function stored<A, I>(schema: Schema.Schema<A, I>, value: unknown): A {
	return Schema.decodeUnknownSync(schema)(value, { onExcessProperty: "error" })
}

function one<A>(rows: readonly A[]): A {
	if (rows.length !== 1) throw new Error(`expected one affected row, received ${rows.length}`)
	return rows[0] as A
}

function mutation<A>(
	context: MutationContext,
	ownerOnly: boolean,
	payload: unknown,
	run: DbEffect<A>,
) {
	return Effect.gen(function* () {
		if (context.actor.scope === "read" || (ownerOnly && context.actor.scope !== "owner")) {
			return yield* new ForbiddenError({ message: "this operation requires the owner session" })
		}
		if (context.key.length === 0 || context.key.length > 200)
			return yield* new ValidationError({
				message: "an idempotency key of 1–200 characters is required",
			})
		const digest = new Bun.CryptoHasher("sha256")
			.update(
				canonical({ method: context.method, target: context.target, payload: normalized(payload) }),
			)
			.digest("hex")
		return yield* serializable(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const receipts = yield* pg<{
					request_digest: string
					status: number
					body: A
				}>`select request_digest, status, body from command_receipts where user_id = ${context.actor.user_id} and client = ${context.actor.client} and command_key = ${context.key}`
				const previous = receipts[0]
				if (previous) {
					if (previous.request_digest !== digest)
						return yield* new ConflictError({
							message: "this idempotency key was already used for a different request",
						})
					return { status: previous.status, body: previous.body }
				}
				const body = yield* run
				one(
					yield* pg`insert into command_receipts (id, user_id, client, command_key, request_digest, status, body) values (${Bun.randomUUIDv7()}, ${context.actor.user_id}, ${context.actor.client}, ${context.key}, ${digest}, 200, ${pg.json(body)}) returning id`,
				)
				return { status: 200, body }
			}),
		)
	})
}

function audit(
	context: MutationContext,
	entityKind: string,
	record: { readonly id: string; readonly revision: number },
	reason: string | null = null,
) {
	return Effect.gen(function* () {
		const pg = yield* PgClient.PgClient
		one(
			yield* pg`insert into changes (id, user_id, entity_kind, entity_id, revision, snapshot, actor, reason, command_key) values (${Bun.randomUUIDv7()}, ${context.actor.user_id}, ${entityKind}, ${record.id}, ${record.revision}, ${pg.json(record)}, ${pg.json(context.actor)}, ${reason}, ${context.key}) returning id`,
		)
	})
}

function requireRevision(
	expected: number | null,
	current: { readonly revision: number } | null | undefined,
) {
	return expected === (current?.revision ?? null)
		? Effect.void
		: Effect.fail(
				new ConflictError({ message: "this record changed elsewhere; review the latest version" }),
			)
}

const transactionColumns = (pg: PgClient.PgClient) =>
	pg`id, date::text, kind, amount_cents::float8 as amount_cents, currency, payee, note, payment_reference, original_expense_id, allocations, revision, voided, owner_protected, created_at::text`
const sourceColumns = (pg: PgClient.PgClient) =>
	pg`id, namespace, external_key, label, media_type, sha256, octet_length(original) as byte_length, external_reference, extraction_complete, revision, created_at::text`
const itemColumns = (pg: PgClient.PgClient) =>
	pg`id, source_id, item_key, revision, proposal, review_reason, correction_target_id, resolution, transaction_id, created_at::text`

function transactionById(actor: H.HistoryActor, id: string) {
	return Effect.gen(function* () {
		const pg = yield* PgClient.PgClient
		const rows =
			yield* pg`select ${transactionColumns(pg)} from transactions where id = ${id} and user_id = ${actor.user_id}`
		if (!rows[0]) return yield* new NotFoundError({ message: "transaction not found" })
		return stored(H.TransactionRecord, rows[0])
	})
}

function sourceById(actor: H.HistoryActor, id: string) {
	return Effect.gen(function* () {
		const pg = yield* PgClient.PgClient
		const rows =
			yield* pg`select ${sourceColumns(pg)} from sources where id = ${id} and user_id = ${actor.user_id}`
		if (!rows[0]) return yield* new NotFoundError({ message: "source not found" })
		return stored(H.SourceRecord, rows[0])
	})
}

function checkOriginal(actor: H.HistoryActor, input: TransactionInput, ownId?: string) {
	return Effect.gen(function* () {
		if (!input.original_expense_id) return
		if (input.kind !== "refund" || input.original_expense_id === ownId)
			return yield* new ValidationError({
				message: "only a refund may refer to a different original expense",
			})
		const original = yield* transactionById(actor, input.original_expense_id)
		if (original.kind !== "expense")
			return yield* new ValidationError({ message: "the original transaction must be an expense" })
	})
}

function insertTransaction(context: MutationContext, input: TransactionInput) {
	return Effect.gen(function* () {
		const pg = yield* PgClient.PgClient
		const transaction = yield* validate(TransactionInput, input)
		yield* H.validateTransaction(transaction)
		yield* checkOriginal(context.actor, transaction)
		const rows =
			yield* pg`insert into transactions (id, user_id, date, kind, amount_cents, currency, payee, note, payment_reference, original_expense_id, allocations, revision, voided, owner_protected)
			values (${Bun.randomUUIDv7()}, ${context.actor.user_id}, ${transaction.date}, ${transaction.kind}, ${transaction.amount_cents}, ${transaction.currency}, ${transaction.payee}, ${transaction.note}, ${transaction.payment_reference}, ${transaction.original_expense_id}, ${pg.json(transaction.allocations)}, 1, false, ${context.actor.scope === "owner"}) returning ${transactionColumns(pg)}`
		const record = stored(H.TransactionRecord, one(rows))
		yield* audit(context, "transaction", record)
		return record
	})
}

function cursorEncode(value: unknown) {
	return Buffer.from(JSON.stringify(value)).toString("base64url")
}
function cursorDecode(cursor: string | undefined, kind: "transaction" | "source" | "change") {
	return Effect.try({
		try: () => {
			if (!cursor) return null
			const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
			if (kind === "change")
				return Schema.decodeUnknownSync(Schema.Struct({ revision: Schema.Int }))(value, {
					onExcessProperty: "error",
				})
			const pair = Schema.decodeUnknownSync(
				Schema.Struct({ value: Schema.String, id: Schema.UUID }),
			)(value, { onExcessProperty: "error" })
			Schema.decodeUnknownSync(CalendarDate)(pair.value.slice(0, 10))
			if (
				kind === "source" &&
				!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?[+-](?:0\d|1[0-5])(?::[0-5]\d)?$/.test(
					pair.value,
				)
			)
				throw new Error("invalid source cursor timestamp")
			return pair
		},
		catch: () => new ValidationError({ message: "invalid pagination cursor" }),
	})
}

export const historyStore = {
	getPlanner: ({ actor }: { actor: H.HistoryActor }) =>
		serializable(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const rows =
					yield* pg`select id, state, revision, created_at::text from planner_templates where user_id = ${actor.user_id}`
				if (!rows[0]) return yield* new NotFoundError({ message: "planner not found" })
				return stored(H.PlannerRecord, rows[0])
			}),
			true,
		),

	putPlanner: ({ context, input }: { context: MutationContext; input: H.PlannerSave }) =>
		mutation(
			context,
			true,
			input,
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const parsed = yield* validate(H.PlannerSave, input)
				const rows = yield* pg<{
					id: string
					revision: number
				}>`select id, revision from planner_templates where user_id = ${context.actor.user_id}`
				const current = rows[0]
				yield* requireRevision(parsed.expected_revision, current)
				const result = current
					? yield* pg`update planner_templates set state = ${pg.json(parsed.state)}, revision = revision + 1 where id = ${current.id} returning id, state, revision, created_at::text`
					: yield* pg`insert into planner_templates (id, user_id, state, revision) values (${Bun.randomUUIDv7()}, ${context.actor.user_id}, ${pg.json(parsed.state)}, 1) returning id, state, revision, created_at::text`
				const record = stored(H.PlannerRecord, one(result))
				yield* audit(context, "planner", record)
				return record
			}),
		),

	getPlan: ({ actor, month }: { actor: H.HistoryActor; month: string }) =>
		serializable(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const rows =
					yield* pg`select id, month, revision, adopted_planner_revision, lines, created_at::text from month_plans where user_id = ${actor.user_id} and month = ${month}`
				if (!rows[0]) return yield* new NotFoundError({ message: "month plan not found" })
				return stored(H.MonthPlanRecord, rows[0])
			}),
			true,
		),

	putPlan: ({
		context,
		month,
		input,
	}: { context: MutationContext; month: string; input: H.MonthPlanSave }) =>
		mutation(
			context,
			true,
			{ month, ...input },
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const parsed = yield* validate(H.MonthPlanSave, input)
				yield* validate(CalendarMonth, month)
				const rows = yield* pg<{
					id: string
					revision: number
				}>`select id, revision from month_plans where user_id = ${context.actor.user_id} and month = ${month}`
				const current = rows[0]
				yield* requireRevision(parsed.expected_revision, current)
				if (current && !parsed.reason?.trim())
					return yield* new ValidationError({
						message: "a reason is required to amend a month plan",
					})
				let lines: H.MonthPlanRecord["lines"]
				let adopted: number | null = null
				if (parsed.kind === "adopt") {
					const planners = yield* pg<{
						state: unknown
						revision: number
					}>`select state, revision from planner_templates where user_id = ${context.actor.user_id}`
					const planner = planners[0]
					if (!planner)
						return yield* new NotFoundError({ message: "save a planner before adopting it" })
					yield* requireRevision(parsed.planner_revision, planner)
					lines = yield* Effect.try({
						try: () => snapshotPlan(stored(PlannerState, planner.state)),
						catch: () =>
							new ValidationError({ message: "the planner total exceeds supported exact amounts" }),
					})
					adopted = planner.revision
				} else lines = parsed.lines
				yield* H.validatePlanLines(lines)
				const result = current
					? yield* pg`update month_plans set revision = revision + 1, adopted_planner_revision = ${adopted}, lines = ${pg.json(lines)} where id = ${current.id} returning id, month, revision, adopted_planner_revision, lines, created_at::text`
					: yield* pg`insert into month_plans (id, user_id, month, revision, adopted_planner_revision, lines) values (${Bun.randomUUIDv7()}, ${context.actor.user_id}, ${month}, 1, ${adopted}, ${pg.json(lines)}) returning id, month, revision, adopted_planner_revision, lines, created_at::text`
				const record = stored(H.MonthPlanRecord, one(result))
				yield* audit(context, "plan", record, parsed.reason ?? null)
				return record
			}),
		),

	getTransaction: ({ actor, id }: { actor: H.HistoryActor; id: string }) =>
		serializable(transactionById(actor, id), true),

	createTransaction: ({
		context,
		input,
	}: { context: MutationContext; input: H.TransactionCreate }) =>
		mutation(
			context,
			true,
			input,
			Effect.gen(function* () {
				const parsed = yield* validate(H.TransactionCreate, input)
				return yield* insertTransaction(context, parsed.transaction)
			}),
		),

	updateTransaction: ({
		context,
		id,
		input,
	}: { context: MutationContext; id: string; input: H.TransactionUpdate }) =>
		mutation(
			context,
			false,
			{ id, ...input },
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const parsed = yield* validate(H.TransactionUpdate, input)
				const current = yield* transactionById(context.actor, id)
				if (
					context.actor.scope !== "owner" &&
					(current.owner_protected || parsed.voided !== current.voided)
				)
					return yield* new ForbiddenError({ message: "the owner must review this correction" })
				yield* requireRevision(parsed.expected_revision, current)
				yield* checkOriginal(context.actor, parsed.transaction, id)
				if (current.kind === "expense" && parsed.transaction.kind !== "expense") {
					const references =
						yield* pg`select id from transactions where original_expense_id = ${id} limit 1`
					if (references.length)
						return yield* new ConflictError({
							message: "an expense referenced by a refund must remain an expense",
						})
				}
				yield* H.validateTransaction(parsed.transaction)
				const t = parsed.transaction
				const rows =
					yield* pg`update transactions set date = ${t.date}, kind = ${t.kind}, amount_cents = ${t.amount_cents}, currency = ${t.currency}, payee = ${t.payee}, note = ${t.note}, payment_reference = ${t.payment_reference}, original_expense_id = ${t.original_expense_id}, allocations = ${pg.json(t.allocations)}, revision = revision + 1, voided = ${parsed.voided}, owner_protected = ${current.owner_protected || context.actor.scope === "owner"} where id = ${id} returning ${transactionColumns(pg)}`
				const record = stored(H.TransactionRecord, one(rows))
				yield* audit(context, "transaction", record, parsed.reason)
				return record
			}),
		),

	createSource: ({ context, input }: { context: MutationContext; input: H.SourceUpload }) =>
		mutation(
			context,
			false,
			input,
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const parsed = yield* validate(H.SourceUpload, input)
				if (parsed.content_base64.length > Math.ceil(H.MAX_SOURCE_BYTES / 3) * 4)
					return yield* new TooLargeError({ message: "originals must be at most 2 mib" })
				if (
					!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
						parsed.content_base64,
					)
				)
					return yield* new ValidationError({ message: "original content must be valid base64" })
				const bytes = Buffer.from(parsed.content_base64, "base64")
				if (bytes.toString("base64") !== parsed.content_base64)
					return yield* new ValidationError({
						message: "original content must use canonical base64",
					})
				if (bytes.byteLength > H.MAX_SOURCE_BYTES)
					return yield* new TooLargeError({ message: "originals must be at most 2 mib" })
				if (bytes.byteLength === 0)
					return yield* new ValidationError({ message: "the original is empty" })
				if (parsed.media_type === "text/plain") {
					const decoded = yield* Effect.try({
						try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
						catch: () => new ValidationError({ message: "text originals must be valid utf-8" }),
					})
					if (decoded.length === 0)
						return yield* new ValidationError({ message: "the original is empty" })
				}
				const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
				const existing =
					yield* pg`select ${sourceColumns(pg)} from sources where user_id = ${context.actor.user_id} and namespace = ${parsed.namespace} and external_key = ${parsed.external_key}`
				if (existing[0]) {
					const record = stored(H.SourceRecord, existing[0])
					if (record.sha256 !== digest)
						return yield* new ConflictError({
							message: "this source identity already has different original content",
						})
					return record
				}
				const rows =
					yield* pg`insert into sources (id, user_id, namespace, external_key, label, media_type, original, sha256, external_reference, extraction_complete, revision) values (${Bun.randomUUIDv7()}, ${context.actor.user_id}, ${parsed.namespace}, ${parsed.external_key}, ${parsed.label}, ${parsed.media_type}, ${bytes}, ${digest}, ${parsed.external_reference}, false, 1) returning ${sourceColumns(pg)}`
				const record = stored(H.SourceRecord, one(rows))
				yield* audit(context, "source", record)
				return record
			}),
		),

	getSource: ({
		actor,
		id,
		query = {},
	}: { actor: H.HistoryActor; id: string; query?: H.SourceDetailQuery }) =>
		serializable(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const source = yield* sourceById(actor, id)
				const parsed = yield* validate(Schema.typeSchema(H.SourceDetailQuery), query)
				const cursor = yield* cursorDecode(parsed.cursor, "source")
				if (cursor && (!("value" in cursor) || !Number.isFinite(Date.parse(cursor.value))))
					return yield* new ValidationError({ message: "invalid source-item cursor" })
				const limit = parsed.limit ?? H.MAX_PAGE_SIZE
				const rows = yield* pg`select ${itemColumns(pg)} from source_items where source_id = ${id}
			and (${cursor?.value ?? null}::timestamptz is null or (created_at, id) < (${cursor?.value ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
			order by created_at desc, id desc limit ${limit + 1}`
				const items = rows.slice(0, limit).map((item) => stored(H.SourceItemRecord, item))
				const last = items.at(-1)
				return {
					source,
					items,
					next_cursor:
						rows.length > limit && last
							? cursorEncode({ value: last.created_at, id: last.id })
							: null,
				}
			}),
			true,
		),

	getSourceContent: ({ actor, id }: { actor: H.HistoryActor; id: string }) =>
		serializable(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const rows = yield* pg<{
					original: Uint8Array
					media_type: string
					label: string
				}>`select original, media_type, label from sources where id = ${id} and user_id = ${actor.user_id}`
				if (!rows[0]) return yield* new NotFoundError({ message: "source not found" })
				return rows[0]
			}),
			true,
		),

	completeSource: ({
		context,
		id,
		input,
	}: { context: MutationContext; id: string; input: H.SourceComplete }) =>
		mutation(
			context,
			false,
			{ id, ...input },
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const parsed = yield* validate(H.SourceComplete, input)
				const source = yield* sourceById(context.actor, id)
				yield* requireRevision(parsed.expected_revision, source)
				if (source.extraction_complete) return source
				const rows =
					yield* pg`update sources set extraction_complete = true, revision = revision + 1 where id = ${id} returning ${sourceColumns(pg)}`
				const record = stored(H.SourceRecord, one(rows))
				yield* audit(context, "source", record)
				return record
			}),
		),

	importItem: ({ context, input }: { context: MutationContext; input: H.ImportCommand }) =>
		mutation(
			context,
			input.kind === "reopen" || input.kind === "relink",
			input,
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const parsed = yield* validate(H.ImportCommand, input)
				const source = yield* sourceById(context.actor, parsed.source_id)
				const existing = yield* pg<{
					public_item: unknown
					accepted_input: unknown
					accepted_outcome: H.ImportResult | null
				}>`select jsonb_build_object('id', id, 'source_id', source_id, 'item_key', item_key, 'revision', revision, 'proposal', proposal, 'review_reason', review_reason, 'correction_target_id', correction_target_id, 'resolution', resolution, 'transaction_id', transaction_id, 'created_at', created_at::text) as public_item, accepted_input, accepted_outcome from source_items where source_id = ${source.id} and item_key = ${parsed.item_key}`
				const row = existing[0]
				const current = row ? stored(H.SourceItemRecord, row.public_item) : null
				const acceptance =
					parsed.kind === "record"
						? normalized({ kind: "record", transaction: parsed.transaction })
						: parsed.kind === "link" || parsed.kind === "relink"
							? { kind: "link", transaction_id: parsed.transaction_id }
							: null
				if (
					current?.resolution === "recorded" &&
					parsed.kind === "record" &&
					canonical(row?.accepted_input) === canonical(acceptance)
				) {
					if (!row?.accepted_outcome)
						return yield* Effect.die(new Error("recorded source item lacks its accepted outcome"))
					return stored(H.ImportResult, row.accepted_outcome)
				}
				yield* requireRevision(parsed.expected_source_revision, source)
				yield* requireRevision(parsed.expected_item_revision, current)
				if (!current && source.extraction_complete && context.actor.scope !== "owner")
					return yield* new ConflictError({
						message: "extraction is complete; the owner must add a missed item",
					})
				if (current && current.resolution !== "pending") {
					const repair =
						(parsed.kind === "reopen" && current.resolution === "ignored") ||
						(parsed.kind === "relink" &&
							(current.resolution === "recorded" || current.resolution === "linked"))
					if (!repair)
						return yield* new ConflictError({
							message: "this source item is already settled; review its existing outcome",
						})
				} else if (parsed.kind === "reopen" || parsed.kind === "relink")
					return yield* new ConflictError({
						message: "this source item cannot make that transition",
					})
				let transaction: H.TransactionRecord | null = null
				let resolution: H.SourceItemRecord["resolution"] = "pending"
				let proposal = current?.proposal ?? null
				let reviewReason = current?.review_reason ?? null
				let correctionTarget = current?.correction_target_id ?? null
				let reason: string | null = null
				if (parsed.kind === "record") {
					if (correctionTarget)
						return yield* new ConflictError({
							message:
								"review and link the existing transaction; a correction cannot create another expense",
						})
					transaction = yield* insertTransaction(context, parsed.transaction)
					resolution = "recorded"
					reviewReason = null
				} else if (parsed.kind === "link" || parsed.kind === "relink") {
					if (
						correctionTarget &&
						correctionTarget !== parsed.transaction_id &&
						context.actor.scope !== "owner"
					)
						return yield* new ForbiddenError({
							message: "only the owner can change a correction target",
						})
					transaction = yield* transactionById(context.actor, parsed.transaction_id)
					yield* requireRevision(parsed.target_revision, transaction)
					if (transaction.voided)
						return yield* new ConflictError({
							message: "evidence cannot link to a voided transaction",
						})
					resolution = "linked"
					reviewReason = null
					if (correctionTarget) correctionTarget = transaction.id
					if (parsed.kind === "relink") reason = parsed.reason
				} else if (parsed.kind === "hold") {
					if (
						current?.correction_target_id &&
						parsed.correction_target_id !== current.correction_target_id &&
						context.actor.scope !== "owner"
					)
						return yield* new ForbiddenError({
							message: "only the owner can change a correction target",
						})
					if (current?.correction_target_id && !parsed.correction_target_id)
						return yield* new ValidationError({
							message: "a correction proposal must retain an existing transaction target",
						})
					if (parsed.correction_target_id)
						yield* transactionById(context.actor, parsed.correction_target_id)
					if (parsed.reason === "correction_conflict" && !parsed.correction_target_id)
						return yield* new ValidationError({
							message: "a correction proposal must identify its existing transaction",
						})
					proposal = parsed.proposal
					reviewReason = parsed.reason
					correctionTarget = parsed.correction_target_id
					reason = parsed.reason
				} else if (parsed.kind === "ignore") {
					resolution = "ignored"
					reason = parsed.reason
				} else {
					reason = parsed.reason
					reviewReason = parsed.review_reason
					if (reviewReason === "correction_conflict" && !correctionTarget)
						return yield* new ValidationError({
							message: "a correction proposal must identify its existing transaction",
						})
				}
				const rows = current
					? yield* pg`update source_items set revision = revision + 1, proposal = ${pg.json(proposal)}, review_reason = ${reviewReason}, correction_target_id = ${correctionTarget}, resolution = ${resolution}, accepted_input = ${pg.json(acceptance)}, accepted_outcome = null, transaction_id = ${transaction?.id ?? null} where id = ${current.id} returning ${itemColumns(pg)}`
					: yield* pg`insert into source_items (id, source_id, item_key, revision, proposal, review_reason, correction_target_id, resolution, accepted_input, transaction_id) values (${Bun.randomUUIDv7()}, ${source.id}, ${parsed.item_key}, 1, ${pg.json(proposal)}, ${reviewReason}, ${correctionTarget}, ${resolution}, ${pg.json(acceptance)}, ${transaction?.id ?? null}) returning ${itemColumns(pg)}`
				const item = stored(H.SourceItemRecord, one(rows))
				const result = stored(H.ImportResult, { status: resolution, item, transaction })
				one(
					yield* pg`update source_items set accepted_outcome = ${pg.json(result)} where id = ${item.id} returning id`,
				)
				yield* audit(context, "source_item", item, reason)
				return result
			}),
		),

	listTransactions: ({ actor, query }: { actor: H.HistoryActor; query: H.TransactionListQuery }) =>
		serializable(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const parsed = yield* validate(Schema.typeSchema(H.TransactionListQuery), query)
				if (parsed.from && parsed.until && parsed.from >= parsed.until)
					return yield* new ValidationError({ message: "from must precede until" })
				const cursor = yield* cursorDecode(parsed.cursor, "transaction")
				if (cursor && !("value" in cursor))
					return yield* new ValidationError({ message: "invalid transaction cursor" })
				if (cursor) yield* validate(CalendarDate, cursor.value)
				const limit = parsed.limit ?? H.MAX_PAGE_SIZE
				const category = parsed.category === "uncategorized" ? null : parsed.category
				const rows =
					yield* pg`select ${transactionColumns(pg)} from transactions where user_id = ${actor.user_id}
			and (${parsed.from ?? null}::date is null or date >= ${parsed.from ?? null}::date)
			and (${parsed.until ?? null}::date is null or date < ${parsed.until ?? null}::date)
			and (${parsed.payee ?? null}::text is null or strpos(lower(payee), lower(${parsed.payee ?? null}::text)) > 0)
			and (${parsed.amount_cents ?? null}::bigint is null or amount_cents = ${parsed.amount_cents ?? null}::bigint)
			and (${category === undefined} or (not voided and exists (select 1 from jsonb_array_elements(allocations) a where (a->>'category_key') is not distinct from ${category ?? null}::text)))
			and (${cursor?.value ?? null}::date is null or (date, id) < (${cursor?.value ?? null}::date, ${cursor?.id ?? null}::uuid))
			order by date desc, id desc limit ${limit + 1}`
				const items = rows.slice(0, limit).map((row) => {
					const transaction = stored(H.TransactionRecord, row)
					return {
						...transaction,
						contribution_cents: transactionContribution(transaction, category),
					}
				})
				const last = items.at(-1)
				return {
					items,
					next_cursor:
						rows.length > limit && last ? cursorEncode({ value: last.date, id: last.id }) : null,
				}
			}),
			true,
		),

	listSources: ({ actor, query }: { actor: H.HistoryActor; query: H.SourceListQuery }) =>
		serializable(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const parsed = yield* validate(Schema.typeSchema(H.SourceListQuery), query)
				const cursor = yield* cursorDecode(parsed.cursor, "source")
				if (cursor && (!("value" in cursor) || !Number.isFinite(Date.parse(cursor.value))))
					return yield* new ValidationError({ message: "invalid source cursor" })
				const limit = parsed.limit ?? H.MAX_PAGE_SIZE
				const rows =
					yield* pg`select ${sourceColumns(pg)} from sources where user_id = ${actor.user_id}
			and (${parsed.namespace ?? null}::text is null or namespace = ${parsed.namespace ?? null})
			and (${parsed.external_key ?? null}::text is null or external_key = ${parsed.external_key ?? null})
			and (${parsed.sha256 ?? null}::text is null or sha256 = ${parsed.sha256 ?? null})
			and (${parsed.transaction_id ?? null}::uuid is null or exists (select 1 from source_items i where i.source_id = sources.id and i.transaction_id = ${parsed.transaction_id ?? null}::uuid))
			and (${parsed.pending ?? null}::text is null or ((not extraction_complete or exists (select 1 from source_items i where i.source_id = sources.id and i.resolution = 'pending')) = ${parsed.pending === "true"}))
			and (${cursor?.value ?? null}::timestamptz is null or (created_at, id) < (${cursor?.value ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
			order by created_at desc, id desc limit ${limit + 1}`
				const items = rows.slice(0, limit).map((row) => stored(H.SourceRecord, row))
				const last = items.at(-1)
				return {
					items,
					next_cursor:
						rows.length > limit && last
							? cursorEncode({ value: last.created_at, id: last.id })
							: null,
				}
			}),
			true,
		),

	getCommand: ({ actor, key }: { actor: H.HistoryActor; key: string }) =>
		serializable(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const rows = yield* pg<{
					status: number
					body: unknown
				}>`select status, body from command_receipts where user_id = ${actor.user_id} and client = ${actor.client} and command_key = ${key}`
				if (!rows[0]) return yield* new NotFoundError({ message: "command outcome not found" })
				return rows[0]
			}),
			true,
		),

	listChanges: ({ actor, query }: { actor: H.HistoryActor; query: H.ChangesQuery }) =>
		serializable(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const parsed = yield* validate(Schema.typeSchema(H.ChangesQuery), query)
				const cursor = yield* cursorDecode(parsed.cursor, "change")
				if (cursor && !("revision" in cursor))
					return yield* new ValidationError({ message: "invalid change cursor" })
				const limit = parsed.limit ?? H.MAX_PAGE_SIZE
				const rows =
					yield* pg`select id, entity_kind, entity_id, revision, snapshot, actor, reason, command_key, created_at::text from changes where user_id = ${actor.user_id} and entity_kind = ${parsed.entity_kind} and entity_id = ${parsed.entity_id} and (${cursor?.revision ?? null}::integer is null or revision < ${cursor?.revision ?? null}::integer) order by revision desc limit ${limit + 1}`
				const items = rows.slice(0, limit).map((row) => stored(H.ChangeRecord, row))
				const last = items.at(-1)
				return {
					items,
					next_cursor:
						rows.length > limit && last ? cursorEncode({ revision: last.revision }) : null,
				}
			}),
			true,
		),

	report: ({ actor, query }: { actor: H.HistoryActor; query: H.ReportQuery }) =>
		serializable(
			Effect.gen(function* () {
				const pg = yield* PgClient.PgClient
				const parsed = yield* validate(Schema.typeSchema(H.ReportQuery), query)
				yield* H.validateReportQuery(parsed)
				const clock = one(
					yield* pg<{ today: string }>`select (now() at time zone 'utc')::date::text as today`,
				)
				const range = reportRange({ ...parsed, today: stored(CalendarDate, clock.today) })
				const plans =
					yield* pg`select id, month, revision, adopted_planner_revision, lines, created_at::text from month_plans where user_id = ${actor.user_id} and month >= ${range.included_months[0] ?? ""} and month <= ${range.included_months.at(-1) ?? ""} order by month`
				const transactions =
					yield* pg`select ${transactionColumns(pg)} from transactions where user_id = ${actor.user_id} and date >= ${range.from}::date and date < ${range.until}::date and not voided`
				const counts = one(
					yield* pg<{ awaiting: number; pending: number }>`select
			(select count(*)::float8 from sources where user_id = ${actor.user_id} and not extraction_complete) as awaiting,
			(select count(*)::float8 from source_items i join sources s on s.id = i.source_id where s.user_id = ${actor.user_id} and i.resolution = 'pending') as pending`,
				)
				const acceptedPlans = plans.map((plan) => stored(H.MonthPlanRecord, plan))
				const acceptedTransactions = transactions.map((transaction) =>
					stored(H.TransactionRecord, transaction),
				)
				return yield* Effect.try({
					try: () =>
						buildReport({
							range,
							plans: acceptedPlans,
							transactions: acceptedTransactions,
							awaiting_extraction_source_count: counts.awaiting,
							pending_item_count: counts.pending,
						}),
					catch: (error) => error,
				}).pipe(
					Effect.catchAll((error) =>
						error instanceof RangeError
							? Effect.fail(
									new ValidationError({ message: "the report exceeds supported exact amounts" }),
								)
							: Effect.die(error),
					),
				)
			}),
			true,
		),
}

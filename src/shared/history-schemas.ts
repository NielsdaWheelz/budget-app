import { Effect, Schema } from "effect"
import {
	CalendarDate,
	CalendarMonth,
	CatalogCategory,
	CategoryKey,
	LabelText,
	LongText,
	MonthPlanLine,
	PlannerState,
	PositiveCents,
	ReportEndDate,
	ReportPeriod,
	Revision,
	TransactionId,
	TransactionInput,
	planLineIssues,
	transactionIssues,
} from "../domain/history"
import { CentsSchema } from "../domain/money"
import { ValidationError } from "./history-errors"

const strict = { parseOptions: { onExcessProperty: "error" as const } }
const timestamp = Schema.String
const nullableText = Schema.NullOr(LongText)
const reason = LongText.pipe(Schema.nonEmptyString(), Schema.trimmed())
const expectedRevision = Schema.NullOr(Revision)
const cursor = Schema.NullOr(Schema.String)
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024
export const MAX_REQUEST_BYTES = 3 * 1024 * 1024
export const MAX_PAGE_SIZE = 100
export const MAX_PROPOSAL_BYTES = 16 * 1024
const queryLimit = Schema.optional(
	Schema.NumberFromString.pipe(Schema.compose(Schema.Int), Schema.between(1, MAX_PAGE_SIZE)),
)

export const PlannerId = Schema.UUID.pipe(Schema.brand("PlannerId"))
export const MonthPlanId = Schema.UUID.pipe(Schema.brand("MonthPlanId"))
export const SourceId = Schema.UUID.pipe(Schema.brand("SourceId"))
export const SourceItemId = Schema.UUID.pipe(Schema.brand("SourceItemId"))
export const ChangeId = Schema.UUID.pipe(Schema.brand("ChangeId"))

export const HistoryActor = Schema.Struct({
	user_id: Schema.String,
	client: Schema.Literal("browser", "jarvis"),
	scope: Schema.Literal("owner", "read", "write"),
})
export type HistoryActor = typeof HistoryActor.Type

export const HistoryCatalog = Schema.Struct({
	currency: Schema.Literal("USD"),
	categories: Schema.Array(CatalogCategory),
	input_limits: Schema.Struct({
		max_cents: Schema.Int,
		max_source_bytes: Schema.Int,
		max_request_bytes: Schema.Int,
		max_page_size: Schema.Int,
		max_label_length: Schema.Int,
		max_text_length: Schema.Int,
		max_proposal_bytes: Schema.Int,
	}),
})
export type HistoryCatalog = typeof HistoryCatalog.Type

export const PlannerRecord = Schema.Struct({
	id: PlannerId,
	state: PlannerState,
	revision: Revision,
	created_at: timestamp,
})
export type PlannerRecord = typeof PlannerRecord.Type
export const PlannerSave = Schema.Struct({
	expected_revision: expectedRevision,
	state: PlannerState,
}).annotations(strict)
export type PlannerSave = typeof PlannerSave.Type

export const MonthPlanRecord = Schema.Struct({
	id: MonthPlanId,
	month: CalendarMonth,
	revision: Revision,
	adopted_planner_revision: Schema.NullOr(Revision),
	lines: Schema.Array(MonthPlanLine),
	created_at: timestamp,
})
export type MonthPlanRecord = typeof MonthPlanRecord.Type
export const MonthPlanSave = Schema.Union(
	Schema.Struct({
		kind: Schema.Literal("adopt"),
		expected_revision: expectedRevision,
		planner_revision: Revision,
		reason: Schema.NullOr(reason),
	}).annotations(strict),
	Schema.Struct({
		kind: Schema.Literal("explicit"),
		expected_revision: expectedRevision,
		lines: Schema.Array(MonthPlanLine),
		reason: Schema.NullOr(reason),
	}).annotations(strict),
)
export type MonthPlanSave = typeof MonthPlanSave.Type

export const TransactionRecord = Schema.Struct({
	...TransactionInput.fields,
	id: TransactionId,
	revision: Revision,
	voided: Schema.Boolean,
	owner_protected: Schema.Boolean,
	created_at: timestamp,
})
export type TransactionRecord = typeof TransactionRecord.Type
export const TransactionCreate = Schema.Struct({
	expected_revision: Schema.Null,
	transaction: TransactionInput,
}).annotations(strict)
export type TransactionCreate = typeof TransactionCreate.Type
export const TransactionUpdate = Schema.Struct({
	expected_revision: Revision,
	transaction: TransactionInput,
	voided: Schema.Boolean,
	reason,
}).annotations(strict)
export type TransactionUpdate = typeof TransactionUpdate.Type
export const TransactionListItem = Schema.Struct({
	...TransactionRecord.fields,
	contribution_cents: CentsSchema,
})
export type TransactionListItem = typeof TransactionListItem.Type
export const TransactionPage = Schema.Struct({
	items: Schema.Array(TransactionListItem),
	next_cursor: cursor,
})
export type TransactionPage = typeof TransactionPage.Type
export const TransactionListQuery = Schema.Struct({
	from: Schema.optional(CalendarDate),
	until: Schema.optional(ReportEndDate),
	category: Schema.optional(Schema.Union(CategoryKey, Schema.Literal("uncategorized"))),
	payee: Schema.optional(Schema.String),
	amount_cents: Schema.optional(Schema.NumberFromString.pipe(Schema.compose(PositiveCents))),
	cursor: Schema.optional(Schema.String),
	limit: queryLimit,
}).annotations(strict)
export type TransactionListQuery = typeof TransactionListQuery.Type

export const ReportQuery = Schema.Struct({
	period: ReportPeriod,
	through_month: Schema.optional(
		Schema.NumberFromString.pipe(Schema.compose(Schema.Int), Schema.between(1, 12)),
	),
}).annotations(strict)
export type ReportQuery = typeof ReportQuery.Type

export const MediaType = Schema.Literal(
	"application/pdf",
	"image/jpeg",
	"image/png",
	"image/webp",
	"text/plain",
)
export const Sha256 = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))
export const SourceUpload = Schema.Struct({
	expected_revision: Schema.Null,
	namespace: LabelText,
	external_key: LabelText,
	label: LabelText,
	media_type: MediaType,
	// justify-base64-over-base64url: the published source-upload contract specifies base64 originals.
	content_base64: Schema.String,
	external_reference: nullableText,
}).annotations(strict)
export type SourceUpload = typeof SourceUpload.Type
export const SourceRecord = Schema.Struct({
	id: SourceId,
	namespace: LabelText,
	external_key: LabelText,
	label: LabelText,
	media_type: MediaType,
	sha256: Sha256,
	byte_length: Schema.NonNegativeInt,
	external_reference: nullableText,
	extraction_complete: Schema.Boolean,
	revision: Revision,
	created_at: timestamp,
})
export type SourceRecord = typeof SourceRecord.Type
export const SourceComplete = Schema.Struct({ expected_revision: Revision }).annotations(strict)
export type SourceComplete = typeof SourceComplete.Type
export const SourcePage = Schema.Struct({ items: Schema.Array(SourceRecord), next_cursor: cursor })
export type SourcePage = typeof SourcePage.Type
export const SourceListQuery = Schema.Struct({
	pending: Schema.optional(Schema.Literal("true", "false")),
	namespace: Schema.optional(Schema.String),
	transaction_id: Schema.optional(TransactionId),
	external_key: Schema.optional(Schema.String),
	sha256: Schema.optional(Sha256),
	cursor: Schema.optional(Schema.String),
	limit: queryLimit,
}).annotations(strict)
export type SourceListQuery = typeof SourceListQuery.Type
export const SourceDetailQuery = Schema.Struct({
	cursor: Schema.optional(Schema.String),
	limit: queryLimit,
}).annotations(strict)
export type SourceDetailQuery = typeof SourceDetailQuery.Type

export const ReviewReason = Schema.Literal(
	"unreadable",
	"payment_unconfirmed",
	"possible_duplicate",
	"correction_conflict",
	"unsupported_currency",
)
export type ReviewReason = typeof ReviewReason.Type
export const Resolution = Schema.Literal("pending", "recorded", "linked", "ignored")
export type Resolution = typeof Resolution.Type
const observedAmount = Schema.Union(Schema.JsonNumber, LongText, Schema.Null)
export const TransactionProposal = Schema.Struct({
	date: Schema.optional(nullableText),
	kind: Schema.optional(Schema.Literal("expense", "refund")),
	amount_cents: Schema.optional(observedAmount),
	currency: Schema.optional(nullableText),
	payee: Schema.optional(nullableText),
	note: Schema.optional(nullableText),
	payment_reference: Schema.optional(nullableText),
	original_expense_id: Schema.optional(Schema.NullOr(TransactionId)),
	allocations: Schema.optional(
		Schema.Array(
			Schema.Struct({ category_key: nullableText, amount_cents: observedAmount }).annotations(
				strict,
			),
		),
	),
})
	.annotations(strict)
	.pipe(
		Schema.filter(
			(proposal) =>
				new TextEncoder().encode(JSON.stringify(proposal)).byteLength <= MAX_PROPOSAL_BYTES,
			{ message: () => "a proposal must fit within 16 kib of utf-8 json" },
		),
	)
	.annotations({
		description:
			"partial observations, at most 16 kib when serialized as utf-8 json; text fields at most 2000 utf-16 code units",
	})
export type TransactionProposal = typeof TransactionProposal.Type
export const SourceItemRecord = Schema.Struct({
	id: SourceItemId,
	source_id: SourceId,
	item_key: LabelText,
	revision: Revision,
	proposal: Schema.NullOr(TransactionProposal),
	review_reason: Schema.NullOr(ReviewReason),
	correction_target_id: Schema.NullOr(TransactionId),
	resolution: Resolution,
	transaction_id: Schema.NullOr(TransactionId),
	created_at: timestamp,
})
export type SourceItemRecord = typeof SourceItemRecord.Type
export const SourceDetail = Schema.Struct({
	source: SourceRecord,
	items: Schema.Array(SourceItemRecord),
	next_cursor: cursor,
})
export type SourceDetail = typeof SourceDetail.Type

const importFields = {
	source_id: SourceId,
	item_key: LabelText,
	expected_source_revision: Revision,
	expected_item_revision: expectedRevision,
}
export const ImportCommand = Schema.Union(
	Schema.Struct({
		...importFields,
		kind: Schema.Literal("record"),
		transaction: TransactionInput,
	}).annotations(strict),
	Schema.Struct({
		...importFields,
		kind: Schema.Literal("link"),
		transaction_id: TransactionId,
		target_revision: Revision,
	}).annotations(strict),
	Schema.Struct({
		...importFields,
		kind: Schema.Literal("hold"),
		proposal: TransactionProposal,
		reason: ReviewReason,
		correction_target_id: Schema.NullOr(TransactionId),
	}).annotations(strict),
	Schema.Struct({ ...importFields, kind: Schema.Literal("ignore"), reason }).annotations(strict),
	Schema.Struct({
		...importFields,
		kind: Schema.Literal("reopen"),
		reason,
		review_reason: ReviewReason,
	}).annotations(strict),
	Schema.Struct({
		...importFields,
		kind: Schema.Literal("relink"),
		transaction_id: TransactionId,
		target_revision: Revision,
		reason,
	}).annotations(strict),
)
export type ImportCommand = typeof ImportCommand.Type
export const ImportResult = Schema.Struct({
	status: Resolution,
	item: SourceItemRecord,
	transaction: Schema.NullOr(TransactionRecord),
})
export type ImportResult = typeof ImportResult.Type

export const EntityKind = Schema.Literal("planner", "plan", "transaction", "source", "source_item")
export type EntityKind = typeof EntityKind.Type
export const ChangeRecord = Schema.Struct({
	id: ChangeId,
	entity_kind: EntityKind,
	entity_id: Schema.UUID,
	revision: Revision,
	snapshot: Schema.Union(
		PlannerRecord,
		MonthPlanRecord,
		TransactionRecord,
		SourceRecord,
		SourceItemRecord,
	),
	actor: Schema.Union(HistoryActor, Schema.Literal("migration")),
	reason: nullableText,
	command_key: Schema.String,
	created_at: timestamp,
})
export type ChangeRecord = typeof ChangeRecord.Type
export const ChangePage = Schema.Struct({ items: Schema.Array(ChangeRecord), next_cursor: cursor })
export type ChangePage = typeof ChangePage.Type
export const ChangesQuery = Schema.Struct({
	entity_kind: EntityKind,
	entity_id: Schema.UUID,
	cursor: Schema.optional(Schema.String),
	limit: queryLimit,
}).annotations(strict)
export type ChangesQuery = typeof ChangesQuery.Type
export const CommandOutcome = Schema.Struct({ status: Schema.Int, body: Schema.Unknown })
export type CommandOutcome = typeof CommandOutcome.Type

export const validateTransaction = (
	transaction: TransactionInput,
): Effect.Effect<TransactionInput, ValidationError> => {
	const issues = transactionIssues(transaction)
	return issues.length
		? Effect.fail(new ValidationError({ message: "invalid transaction", issues }))
		: Effect.succeed(transaction)
}

export const validatePlanLines = (
	lines: ReadonlyArray<MonthPlanLine>,
): Effect.Effect<ReadonlyArray<MonthPlanLine>, ValidationError> => {
	const issues = planLineIssues(lines)
	return issues.length
		? Effect.fail(new ValidationError({ message: "invalid monthly plan", issues }))
		: Effect.succeed(lines)
}

export const validateReportQuery = (
	query: ReportQuery,
): Effect.Effect<ReportQuery, ValidationError> =>
	query.period.length === 7 && query.through_month !== undefined
		? Effect.fail(
				new ValidationError({
					message: "through_month is only valid for a year report",
					issues: [{ path: ["through_month"], message: "omit this field for a monthly report" }],
				}),
			)
		: Effect.succeed(query)

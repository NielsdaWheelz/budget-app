import { expect, test } from "bun:test"
import { Effect, Option, Schema } from "effect"
import { BASE_LINE_ITEMS } from "../config/budget-config"
import {
	ChangePage,
	ImportCommand,
	SourceUpload,
	TransactionCreate,
	TransactionProposal,
	validateReportQuery,
	validateTransaction,
} from "../shared/history-schemas"
import {
	CalendarDate,
	CalendarMonth,
	CategoryKey,
	HistoryReport,
	PlannerState,
	ReportPeriod,
	type ReportPlan,
	TransactionInput,
	buildReport,
	categories,
	planLineIssues,
	reportRange,
	snapshotPlan,
	transactionContribution,
	transactionIssues,
} from "./history"
import { type Cents, parseMoney } from "./money"

const today = Schema.decodeUnknownSync(CalendarDate)("2026-09-11")
const groceryKey = Schema.decodeUnknownSync(CategoryKey)("Groceries")
const shoppingKey = Schema.decodeUnknownSync(CategoryKey)("Shopping")
const planner = (groceries: number) =>
	Schema.decodeUnknownSync(PlannerState)({
		grossIncome: 1500000,
		healthInsurance: 100000,
		rentersInsurance: 10000,
		scenarioName: "Solo",
		period: "Monthly",
		lineItemAmounts: Object.fromEntries(
			BASE_LINE_ITEMS.map((item) => [item.key, item.key === "Groceries" ? groceries : 0]),
		),
	})
const plan = (month: string, groceries: number): ReportPlan => ({
	month: Schema.decodeUnknownSync(CalendarMonth)(month),
	revision: 1,
	lines: snapshotPlan(planner(groceries)),
})
const transaction = (date: string, amount: number, kind = "expense") => ({
	...Schema.decodeUnknownSync(TransactionInput)({
		date,
		kind,
		amount_cents: amount,
		currency: "USD",
		payee: "Market",
		note: null,
		payment_reference: null,
		original_expense_id: null,
		allocations: [{ category_key: "Groceries", amount_cents: amount }],
	}),
	voided: false,
})

test("decimal input is exact, complete, nonnegative, and bounded", () => {
	expect(Option.getOrThrow(parseMoney("0.29"))).toBe(29 as Cents)
	expect(Option.getOrThrow(parseMoney(" 15.9 "))).toBe(1590 as Cents)
	expect(Option.getOrThrow(parseMoney("90071992547409.91"))).toBe(Number.MAX_SAFE_INTEGER as Cents)
	for (const text of ["", "1.001", "1abc", "1e3", "1,000", "$1", "-1", ".5", "90071992547409.92"]) {
		expect(Option.isNone(parseMoney(text))).toBe(true)
	}
})

test("calendar dates validate real days and keep a representable report end", () => {
	for (const date of ["2024-02-29", "2000-02-29", "0001-01-01", "9998-12-31"])
		expect(Schema.is(CalendarDate)(date)).toBe(true)
	for (const date of [
		"1900-02-29",
		"2025-02-29",
		"2026-04-31",
		"2026-9-01",
		"2026-09-01T00:00:00Z",
		"0000-01-01",
		"9999-12-31",
	])
		expect(Schema.is(CalendarDate)(date)).toBe(false)
	expect(Schema.is(ReportPeriod)("9999")).toBe(false)
})

test("accepted money and fields are strict; allocations require exact distinct categories", async () => {
	const input = transaction("2026-09-30", 24595)
	const valid = {
		...input,
		allocations: [
			{ category_key: "Groceries", amount_cents: 3000 },
			{ category_key: "Shopping", amount_cents: 21595 },
		],
	}
	const { voided: _voided, ...wire } = valid
	const accepted = Schema.decodeUnknownSync(TransactionInput)(wire)
	expect(transactionIssues(accepted)).toEqual([])
	expect(
		transactionIssues({
			...accepted,
			allocations: [
				{ category_key: groceryKey, amount_cents: 2999 as Cents },
				{ category_key: shoppingKey, amount_cents: 21595 as Cents },
			],
		}),
	).toHaveLength(1)
	expect(
		transactionIssues({
			...accepted,
			allocations: [
				{ category_key: groceryKey, amount_cents: 1 as Cents },
				{ category_key: groceryKey, amount_cents: 24594 as Cents },
			],
		}),
	).toHaveLength(1)
	for (const change of [
		{ amount_cents: 0 },
		{ amount_cents: 1.5 },
		{ amount_cents: Number.MAX_SAFE_INTEGER + 1 },
		{ currency: "EUR" },
		{ owner_protected: true },
	]) {
		expect(() => Schema.decodeUnknownSync(TransactionInput)({ ...wire, ...change })).toThrow()
	}
	const failed = await Effect.runPromise(
		Effect.either(validateTransaction({ ...accepted, amount_cents: 1 as Cents })),
	)
	expect(failed._tag).toBe("Left")
})

test("planner requires exactly the fixed category catalog", () => {
	const good = planner(50000)
	const missing = Object.fromEntries(
		Object.entries(good.lineItemAmounts).filter(([key]) => key !== "Groceries"),
	)
	expect(() =>
		Schema.decodeUnknownSync(PlannerState)({ ...good, lineItemAmounts: missing }),
	).toThrow()
	expect(() =>
		Schema.decodeUnknownSync(PlannerState)({
			...good,
			lineItemAmounts: { ...good.lineItemAmounts, Salary: 1 },
		}),
	).toThrow()
	expect(() =>
		Schema.decodeUnknownSync(PlannerState)({ ...good, scenarioName: "Unknown" }),
	).toThrow()
})

test("adopted monthly amounts stay independent of view period and later planner changes", () => {
	const original = planner(50000)
	const adopted = snapshotPlan(original)
	const changed = planner(60000)
	expect(snapshotPlan({ ...original, period: "Yearly" })).toEqual(adopted)
	expect(
		snapshotPlan(changed).find((line) => line.category_key === "Groceries")?.planned_cents,
	).toBe(60000 as Cents)
	expect(adopted.find((line) => line.category_key === "Groceries")?.planned_cents).toBe(
		50000 as Cents,
	)
	const shared = snapshotPlan(
		Schema.decodeUnknownSync(PlannerState)({
			...original,
			scenarioName: "OneRoommate",
			lineItemAmounts: { ...original.lineItemAmounts, Rent: 320000 },
		}),
	)
	expect(shared.find((line) => line.category_key === "Rent")?.planned_cents).toBe(160000 as Cents)
	expect(planLineIssues(adopted)).toEqual([])
	expect(planLineIssues(adopted.slice(1))).toHaveLength(1)
})

test("report ranges use UTC context only for the current-year default", async () => {
	expect(reportRange({ period: "2026", today })).toMatchObject({
		from: "2026-01-01",
		until: "2026-10-01",
	})
	expect(reportRange({ period: "2025", today }).included_months).toHaveLength(12)
	expect(String(reportRange({ period: "2027", today }).until)).toBe("2028-01-01")
	expect(String(reportRange({ period: "2026", through_month: 12, today }).until)).toBe("2027-01-01")
	expect(reportRange({ period: "2026-09", today }).included_months.map(String)).toEqual(["2026-09"])
	expect(reportRange({ period: "9998", today }).until).toBe("9999-01-01")
	const invalid = await Effect.runPromise(
		Effect.either(validateReportQuery({ period: "2026-09", through_month: 3 })),
	)
	expect(invalid._tag).toBe("Left")
})

test("published reports reject invalid range dates and negative planned money", () => {
	const report = buildReport({
		range: reportRange({ period: "2026-09", today }),
		plans: [plan("2026-09", 0)],
		transactions: [],
		awaiting_extraction_source_count: 0,
		pending_item_count: 0,
	})
	expect(Schema.is(HistoryReport)(report)).toBe(true)
	for (const change of [
		{ from: "2026-02-30" },
		{ until: "2026-13-01" },
		{ planned_cents: -1 },
		{ known_planned_cents: -1 },
		{ rows: report.rows.map((row) => ({ ...row, planned_cents: -1 })) },
	])
		expect(Schema.is(HistoryReport)({ ...report, ...change })).toBe(false)
	expect(
		Schema.is(HistoryReport)(
			buildReport({
				range: reportRange({ period: "9998", today }),
				plans: [],
				transactions: [],
				awaiting_extraction_source_count: 0,
				pending_item_count: 0,
			}),
		),
	).toBe(true)
})

test("late uploads and later refunds affect their own financial months", () => {
	const transactions = [transaction("2026-09-30", 51595), transaction("2026-10-05", 2000, "refund")]
	const september = buildReport({
		range: reportRange({ period: "2026-09", today }),
		plans: [plan("2026-09", 50000)],
		transactions,
		awaiting_extraction_source_count: 1,
		pending_item_count: 2,
	})
	expect(september).toMatchObject({
		planned_cents: 50000,
		recorded_cents: 51595,
		difference_cents: 1595,
		transaction_count: 1,
	})
	const october = buildReport({
		range: reportRange({ period: "2026-10", today }),
		plans: [],
		transactions,
		awaiting_extraction_source_count: 0,
		pending_item_count: 0,
	})
	expect(october).toMatchObject({
		planned_cents: null,
		recorded_cents: -2000,
		difference_cents: null,
		transaction_count: 1,
	})
})

test("annual totals use included plans, and missing coverage suppresses the difference", () => {
	const report = buildReport({
		range: reportRange({ period: "2026", through_month: 10, today }),
		plans: [plan("2026-10", 60000), plan("2026-09", 50000)],
		transactions: [],
		awaiting_extraction_source_count: 0,
		pending_item_count: 0,
	})
	expect(report).toMatchObject({
		planned_cents: null,
		known_planned_cents: 110000,
		difference_cents: null,
	})
	expect(report.missing_plan_months).toHaveLength(8)
	expect(report.plan_revisions.map((item) => String(item.month))).toEqual(["2026-09", "2026-10"])
})

test("net zero keeps both transactions; uncategorized and split contributions remain visible", () => {
	const expense = transaction("2026-09-11", 10000)
	const split = {
		...expense,
		allocations: [
			{ category_key: groceryKey, amount_cents: 9000 as Cents },
			{ category_key: null, amount_cents: 1000 as Cents },
		],
	}
	const refund = { ...split, kind: "refund" as const }
	expect(transactionContribution(split, groceryKey)).toBe(9000 as Cents)
	expect(transactionContribution(split, null)).toBe(1000 as Cents)
	const report = buildReport({
		range: reportRange({ period: "2026-09", today }),
		plans: [plan("2026-09", 0)],
		transactions: [split, refund, { ...expense, voided: true }],
		awaiting_extraction_source_count: 0,
		pending_item_count: 0,
	})
	expect(report).toMatchObject({ recorded_cents: 0, transaction_count: 2, difference_cents: 0 })
	expect(report.rows).toHaveLength(categories.length)
})

test("request schemas reject privilege fields while proposals retain uncertain observations", () => {
	const { voided: _voided, ...input } = transaction("2026-09-11", 100)
	expect(() =>
		Schema.decodeUnknownSync(TransactionCreate)({
			expected_revision: null,
			transaction: input,
			actor: "owner",
		}),
	).toThrow()
	expect(() =>
		Schema.decodeUnknownSync(SourceUpload)({
			expected_revision: null,
			namespace: "mail/account",
			external_key: "1",
			label: "invoice",
			media_type: "text/plain",
			content_base64: "YQ==",
			external_reference: null,
			extraction_complete: true,
		}),
	).toThrow()
	const command = Schema.decodeUnknownSync(ImportCommand)({
		source_id: "0199335a-0000-7000-8000-000000000001",
		item_key: "invoice",
		expected_source_revision: 1,
		expected_item_revision: null,
		kind: "hold",
		proposal: { amount_cents: "unreadable", currency: "EUR" },
		reason: "unsupported_currency",
		correction_target_id: null,
	})
	expect(command.kind).toBe("hold")
})

test("bounded ingress keeps an escaped maximum audit page below the deployment response limit", () => {
	const upload = {
		expected_revision: null,
		namespace: "mail/account",
		external_key: "receipt",
		label: "receipt.txt",
		media_type: "text/plain",
		content_base64: "YQ==",
		external_reference: null,
	}
	expect(Schema.is(SourceUpload)(upload)).toBe(true)
	for (const label of ["a".repeat(201), "invalid\ud800name", "invalid\u0000name"])
		expect(Schema.is(SourceUpload)({ ...upload, label })).toBe(false)
	const proposal = {
		date: "é".repeat(2000),
		payee: "é".repeat(2000),
		note: "é".repeat(2000),
		payment_reference: "é".repeat(2000),
	}
	expect(Schema.is(TransactionProposal)(proposal)).toBe(true)
	expect(Schema.is(TransactionProposal)({ ...proposal, currency: "é".repeat(2000) })).toBe(false)
	const { voided: _voided, ...input } = transaction("2026-09-11", Number.MAX_SAFE_INTEGER)
	expect(Schema.is(TransactionInput)({ ...input, note: "a".repeat(2001) })).toBe(false)
	const snapshot = {
		...input,
		id: "0199335a-0000-7000-8000-000000000001",
		revision: 1,
		payee: "\u0001".repeat(200),
		note: "\u0001".repeat(2000),
		payment_reference: "\u0001".repeat(2000),
		allocations: categories.map((category, index) => ({
			category_key: category.category_key,
			amount_cents: index === categories.length - 1 ? Number.MAX_SAFE_INTEGER - index : 1,
		})),
		voided: false,
		owner_protected: true,
		created_at: "2026-09-11T00:00:00.000Z",
	}
	const page = Schema.decodeUnknownSync(ChangePage)({
		items: Array.from({ length: 100 }, (_, index) => ({
			id: snapshot.id,
			entity_kind: "transaction",
			entity_id: snapshot.id,
			revision: index + 1,
			snapshot,
			actor: { user_id: snapshot.id, client: "browser", scope: "owner" },
			reason: "\u0001".repeat(2000),
			command_key: "\u0001".repeat(200),
			created_at: snapshot.created_at,
		})),
		next_cursor: "next-page",
	})
	const bytes = new TextEncoder().encode(JSON.stringify(page)).byteLength
	expect(bytes).toBeGreaterThan(3_500_000)
	expect(bytes).toBeLessThan(4_500_000)
})

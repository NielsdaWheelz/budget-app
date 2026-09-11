import { Schema } from "effect"
import { BASE_LINE_ITEMS } from "../config/budget-config"
import { LineItemKeySchema } from "./budget"
import { type Cents, CentsSchema, ZERO, subtract, sum } from "./money"
import { SCENARIOS, ScenarioName, applyScenarioShare } from "./scenario"

const strict = { parseOptions: { onExcessProperty: "error" as const } }

export const MAX_LABEL_LENGTH = 200
export const MAX_TEXT_LENGTH = 2000
export const LongText = Schema.String.pipe(
	Schema.maxLength(MAX_TEXT_LENGTH),
	Schema.filter(
		(value) => {
			if (value.includes("\u0000")) return false
			try {
				encodeURIComponent(value)
				return true
			} catch {
				return false
			}
		},
		{ message: () => "text must contain valid unicode without nul characters" },
	),
).annotations({
	description: "at most 2000 utf-16 code units; valid unicode without nul characters",
})
export const LabelText = LongText.pipe(
	Schema.nonEmptyString(),
	Schema.trimmed(),
	Schema.maxLength(MAX_LABEL_LENGTH),
).annotations({
	description:
		"nonempty trimmed text, at most 200 utf-16 code units; valid unicode without nul characters",
})

export const PositiveCents = CentsSchema.pipe(Schema.greaterThan(0))
export const NonNegativeCents = CentsSchema.pipe(Schema.greaterThanOrEqualTo(0))
export const Revision = Schema.Int.pipe(Schema.greaterThan(0))
export const CategoryKey = LineItemKeySchema.pipe(
	Schema.filter((key) => BASE_LINE_ITEMS.some((item) => item.key === key), {
		message: () => "unknown spending category",
	}),
)
export type CategoryKey = typeof CategoryKey.Type
export const SpendingGroup = Schema.Literal(
	"FixedExpenses",
	"VariableExpenses",
	"Discretionary",
	"uncategorized",
)

const validDate = (value: string): boolean => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
	const year = Number(value.slice(0, 4))
	const month = Number(value.slice(5, 7))
	const day = Number(value.slice(8, 10))
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
	return (
		year > 0 &&
		year <= 9998 &&
		month >= 1 &&
		month <= 12 &&
		day >= 1 &&
		day <= (days[month - 1] ?? 0)
	)
}

export const CalendarDate = Schema.String.pipe(
	Schema.filter(validDate),
	Schema.brand("CalendarDate"),
)
export type CalendarDate = typeof CalendarDate.Type
export const ReportEndDate = Schema.Union(CalendarDate, Schema.Literal("9999-01-01"))
export const CalendarMonth = Schema.String.pipe(
	Schema.filter((value) => /^\d{4}-\d{2}$/.test(value) && validDate(`${value}-01`)),
	Schema.brand("CalendarMonth"),
)
export type CalendarMonth = typeof CalendarMonth.Type
export const ReportPeriod = Schema.String.pipe(
	Schema.filter((value) =>
		/^\d{4}$/.test(value)
			? Number(value) > 0 && Number(value) <= 9998
			: /^\d{4}-\d{2}$/.test(value) && validDate(`${value}-01`),
	),
)

export const PlannerState = Schema.Struct({
	grossIncome: NonNegativeCents,
	healthInsurance: NonNegativeCents,
	rentersInsurance: NonNegativeCents,
	scenarioName: ScenarioName,
	period: Schema.Literal("Monthly", "Yearly"),
	lineItemAmounts: Schema.Record({ key: CategoryKey, value: NonNegativeCents }).annotations(strict),
})
	.annotations(strict)
	.pipe(
		Schema.filter(
			(planner) =>
				Object.keys(planner.lineItemAmounts).length === BASE_LINE_ITEMS.length &&
				BASE_LINE_ITEMS.every((item) => Object.hasOwn(planner.lineItemAmounts, item.key)),
			{ message: () => "planner must include every spending category exactly once" },
		),
	)
export type PlannerState = typeof PlannerState.Type

export const Allocation = Schema.Struct({
	category_key: Schema.NullOr(CategoryKey),
	amount_cents: PositiveCents,
}).annotations(strict)
export type Allocation = typeof Allocation.Type

export const TransactionId = Schema.UUID.pipe(Schema.brand("TransactionId"))
export const TransactionInput = Schema.Struct({
	date: CalendarDate,
	kind: Schema.Literal("expense", "refund"),
	amount_cents: PositiveCents,
	currency: Schema.Literal("USD"),
	payee: LabelText,
	note: Schema.NullOr(LongText),
	payment_reference: Schema.NullOr(LongText),
	original_expense_id: Schema.NullOr(TransactionId),
	allocations: Schema.Array(Allocation).pipe(Schema.minItems(1)),
}).annotations(strict)
export type TransactionInput = typeof TransactionInput.Type

export const MonthPlanLine = Schema.Struct({
	category_key: Schema.NullOr(CategoryKey),
	label: LabelText,
	group: SpendingGroup,
	planned_cents: NonNegativeCents,
}).annotations(strict)
export type MonthPlanLine = typeof MonthPlanLine.Type

export const CatalogCategory = Schema.Struct({
	category_key: Schema.NullOr(CategoryKey),
	label: LabelText,
	group: SpendingGroup,
})
export type CatalogCategory = typeof CatalogCategory.Type
export const categories: ReadonlyArray<CatalogCategory> = [
	...BASE_LINE_ITEMS.map((item) => ({
		category_key: item.key,
		label: item.label,
		group: item.group as "FixedExpenses" | "VariableExpenses" | "Discretionary",
	})),
	{ category_key: null, label: "Uncategorized", group: "uncategorized" },
]

export type FinancialIssue = {
	readonly path: ReadonlyArray<string | number>
	readonly message: string
}

export const transactionIssues = (transaction: TransactionInput): ReadonlyArray<FinancialIssue> => {
	const issues: FinancialIssue[] = []
	const keys = new Set(transaction.allocations.map((item) => item.category_key))
	if (keys.size !== transaction.allocations.length)
		issues.push({ path: ["allocations"], message: "categories must be distinct" })
	if (
		transaction.allocations.reduce((total, item) => total + BigInt(item.amount_cents), 0n) !==
		BigInt(transaction.amount_cents)
	) {
		issues.push({
			path: ["allocations"],
			message: "allocations must sum exactly to the transaction amount",
		})
	}
	if (transaction.kind === "expense" && transaction.original_expense_id !== null)
		issues.push({
			path: ["original_expense_id"],
			message: "only refunds may link an original expense",
		})
	return issues
}

export const planLineIssues = (
	lines: ReadonlyArray<MonthPlanLine>,
): ReadonlyArray<FinancialIssue> => {
	const keys = new Set(lines.map((line) => line.category_key))
	const issues: FinancialIssue[] = []
	if (
		lines.length !== categories.length ||
		keys.size !== categories.length ||
		categories.some((category) => !keys.has(category.category_key))
	) {
		issues.push({
			path: ["lines"],
			message: "include every spending category and uncategorized exactly once",
		})
	}
	if (
		lines.some(
			(line) =>
				line.category_key === null && (line.planned_cents !== 0 || line.group !== "uncategorized"),
		)
	) {
		issues.push({
			path: ["lines"],
			message: "uncategorized must have a zero plan and uncategorized group",
		})
	}
	if (
		lines.reduce((total, line) => total + BigInt(line.planned_cents), 0n) >
		BigInt(Number.MAX_SAFE_INTEGER)
	) {
		issues.push({ path: ["lines"], message: "planned total exceeds safe integer cents" })
	}
	return issues
}

export const snapshotPlan = (planner: PlannerState): ReadonlyArray<MonthPlanLine> => {
	const scenario = SCENARIOS.find((item) => item.name === planner.scenarioName)
	// justify-defect: PlannerState validates the scenario against the fixed catalog.
	if (!scenario) throw new Error("validated planner scenario missing from catalog")
	const lines: MonthPlanLine[] = BASE_LINE_ITEMS.map((item) => {
		const amount = planner.lineItemAmounts[item.key]
		// justify-defect: the complete PlannerState schema guarantees every catalog key.
		if (amount === undefined) throw new Error("validated planner category missing")
		return {
			category_key: item.key,
			label: item.label,
			group: item.group as "FixedExpenses" | "VariableExpenses" | "Discretionary",
			planned_cents: applyScenarioShare(amount, scenario, item.key),
		}
	})
	lines.push({
		category_key: null,
		label: "Uncategorized",
		group: "uncategorized",
		planned_cents: ZERO,
	})
	sum(lines.map((line) => line.planned_cents))
	return lines
}

export type ReportRange = {
	readonly period: string
	readonly from: CalendarDate
	readonly until: typeof ReportEndDate.Type
	readonly included_months: ReadonlyArray<CalendarMonth>
}

export const reportRange = ({
	period,
	through_month,
	today,
}: {
	readonly period: typeof ReportPeriod.Type
	readonly through_month?: number
	readonly today: CalendarDate
}): ReportRange => {
	const year = Number(period.slice(0, 4))
	const first = period.length === 7 ? Number(period.slice(5, 7)) : 1
	const last =
		period.length === 7
			? first
			: (through_month ??
				(period.slice(0, 4) === today.slice(0, 4) ? Number(today.slice(5, 7)) : 12))
	const included_months = Array.from(
		{ length: last - first + 1 },
		(_, index) =>
			`${String(year).padStart(4, "0")}-${String(first + index).padStart(2, "0")}` as CalendarMonth,
	)
	const from =
		`${String(year).padStart(4, "0")}-${String(first).padStart(2, "0")}-01` as CalendarDate
	const until =
		`${String(last === 12 ? year + 1 : year).padStart(4, "0")}-${String(last === 12 ? 1 : last + 1).padStart(2, "0")}-01` as typeof ReportEndDate.Type
	return { period, from, until, included_months }
}

export type ReportTransaction = Pick<
	TransactionInput,
	"date" | "kind" | "amount_cents" | "allocations"
> & { readonly voided: boolean }
export type ReportPlan = {
	readonly month: CalendarMonth
	readonly revision: number
	readonly lines: ReadonlyArray<MonthPlanLine>
}

export const transactionContribution = (
	transaction: ReportTransaction,
	category?: CategoryKey | null,
): Cents => {
	if (transaction.voided) return ZERO
	const amount =
		category === undefined
			? transaction.amount_cents
			: sum(
					transaction.allocations
						.filter((item) => item.category_key === category)
						.map((item) => item.amount_cents),
				)
	switch (transaction.kind) {
		case "expense":
			return amount
		case "refund":
			return -amount as Cents
	}
}

export const ReportRow = Schema.Struct({
	category_key: Schema.NullOr(CategoryKey),
	label: LabelText,
	planned_cents: Schema.NullOr(NonNegativeCents),
	recorded_cents: CentsSchema,
	difference_cents: Schema.NullOr(CentsSchema),
})
export type ReportRow = typeof ReportRow.Type

export const HistoryReport = Schema.Struct({
	period: ReportPeriod,
	from: CalendarDate,
	until: ReportEndDate,
	currency: Schema.Literal("USD"),
	included_months: Schema.Array(CalendarMonth),
	missing_plan_months: Schema.Array(CalendarMonth),
	plan_revisions: Schema.Array(Schema.Struct({ month: CalendarMonth, revision: Revision })),
	transaction_count: Schema.NonNegativeInt,
	awaiting_extraction_source_count: Schema.NonNegativeInt,
	pending_item_count: Schema.NonNegativeInt,
	rows: Schema.Array(ReportRow),
	planned_cents: Schema.NullOr(NonNegativeCents),
	known_planned_cents: NonNegativeCents,
	recorded_cents: CentsSchema,
	difference_cents: Schema.NullOr(CentsSchema),
})
export type HistoryReport = typeof HistoryReport.Type

export const buildReport = ({
	range,
	plans,
	transactions,
	awaiting_extraction_source_count,
	pending_item_count,
}: {
	readonly range: ReportRange
	readonly plans: ReadonlyArray<ReportPlan>
	readonly transactions: ReadonlyArray<ReportTransaction>
	readonly awaiting_extraction_source_count: number
	readonly pending_item_count: number
}): HistoryReport => {
	const included = new Set(range.included_months)
	const selectedPlans = plans
		.filter((plan) => included.has(plan.month))
		.sort((left, right) => left.month.localeCompare(right.month))
	const covered = new Set(selectedPlans.map((plan) => plan.month))
	const missing_plan_months = range.included_months.filter((month) => !covered.has(month))
	const selected = transactions.filter(
		(transaction) =>
			!transaction.voided && transaction.date >= range.from && transaction.date < range.until,
	)
	const rows = categories.map((category): ReportRow => {
		const lines = selectedPlans.flatMap((plan) =>
			plan.lines.filter((line) => line.category_key === category.category_key),
		)
		const planned = sum(lines.map((line) => line.planned_cents))
		const recorded = sum(
			selected.map((transaction) => transactionContribution(transaction, category.category_key)),
		)
		return {
			category_key: category.category_key,
			label: lines.at(-1)?.label ?? category.label,
			planned_cents: missing_plan_months.length ? null : planned,
			recorded_cents: recorded,
			difference_cents: missing_plan_months.length ? null : subtract(recorded, planned),
		}
	})
	const known_planned_cents = sum(
		selectedPlans.flatMap((plan) => plan.lines.map((line) => line.planned_cents)),
	)
	const recorded_cents = sum(rows.map((row) => row.recorded_cents))
	return {
		...range,
		currency: "USD",
		missing_plan_months,
		plan_revisions: selectedPlans.map(({ month, revision }) => ({ month, revision })),
		transaction_count: selected.length,
		awaiting_extraction_source_count,
		pending_item_count,
		rows,
		known_planned_cents,
		planned_cents: missing_plan_months.length ? null : known_planned_cents,
		recorded_cents,
		difference_cents: missing_plan_months.length
			? null
			: subtract(recorded_cents, known_planned_cents),
	}
}

import { Context, Effect, Layer } from "effect"
import type { BudgetResult, CategoryGroup, CategorySummary, LineItem } from "../domain/budget"
import { type Cents, subtract, sum } from "../domain/money"
import type { TakeHomePay } from "../domain/payroll"

const buildCategorySummary = (
	group: CategoryGroup,
	items: ReadonlyArray<LineItem>,
): CategorySummary => {
	const groupItems = items.filter((item) => item.group === group)
	const subtotal = sum(groupItems.map((item) => item.amount))
	return { group, items: groupItems, subtotal }
}

const EXPENSE_GROUPS: ReadonlyArray<CategoryGroup> = [
	"FixedExpenses",
	"VariableExpenses",
	"Discretionary",
]

export class BudgetService extends Context.Tag("BudgetService")<
	BudgetService,
	{
		readonly computeBudget: (params: {
			readonly grossIncome: Cents
			readonly takeHomePay: TakeHomePay
			readonly lineItems: ReadonlyArray<LineItem>
		}) => Effect.Effect<BudgetResult>
	}
>() {
	static readonly layer = Layer.succeed(
		BudgetService,
		BudgetService.of({
			computeBudget: ({ grossIncome, takeHomePay, lineItems }) =>
				Effect.gen(function* () {
					const categories: Array<CategorySummary> = [
						buildCategorySummary("PaycheckDeductions", lineItems),
						buildCategorySummary("FixedExpenses", lineItems),
						buildCategorySummary("VariableExpenses", lineItems),
						buildCategorySummary("Discretionary", lineItems),
						buildCategorySummary("Savings", lineItems),
					].filter((c) => c.items.length > 0)

					const totalExpenses = sum(
						categories.filter((c) => EXPENSE_GROUPS.includes(c.group)).map((c) => c.subtotal),
					)

					const savings = subtract(takeHomePay.netIncome, totalExpenses)

					return {
						grossIncome,
						takeHomePay,
						categories,
						savings,
					}
				}),
		}),
	)
}

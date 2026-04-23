import { Brand, Schema } from "effect"
import { CentsSchema } from "./money"
import { TakeHomePay } from "./payroll"

export const CategoryGroup = Schema.Literal(
	"PaycheckDeductions",
	"FixedExpenses",
	"VariableExpenses",
	"Discretionary",
	"Savings",
)
export type CategoryGroup = typeof CategoryGroup.Type

export type LineItemKey = string & Brand.Brand<"LineItemKey">

export const LineItemKey = Brand.nominal<LineItemKey>()

export const LineItemKeySchema = Schema.String.pipe(Schema.brand("LineItemKey"))

export const LineItem = Schema.Struct({
	key: LineItemKeySchema,
	label: Schema.String,
	amount: CentsSchema,
	group: CategoryGroup,
	editable: Schema.Boolean,
})
export type LineItem = typeof LineItem.Type

export const CategorySummary = Schema.Struct({
	group: CategoryGroup,
	items: Schema.Array(LineItem),
	subtotal: CentsSchema,
})
export type CategorySummary = typeof CategorySummary.Type

export const BudgetResult = Schema.Struct({
	grossIncome: CentsSchema,
	takeHomePay: TakeHomePay,
	categories: Schema.Array(CategorySummary),
	savings: CentsSchema,
})
export type BudgetResult = typeof BudgetResult.Type

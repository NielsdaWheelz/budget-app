import { Data, Schema } from "effect"
import { CentsSchema } from "./money"

export const FilingStatus = Schema.Literal(
	"Single",
	"MarriedFilingJointly",
	"MarriedFilingSeparately",
	"HeadOfHousehold",
)
export type FilingStatus = typeof FilingStatus.Type

export const TaxJurisdiction = Schema.Literal("Federal", "California")
export type TaxJurisdiction = typeof TaxJurisdiction.Type

export const TaxBracket = Schema.Struct({
	min: CentsSchema,
	max: Schema.NullOr(CentsSchema),
	rate: Schema.Number,
})
export type TaxBracket = typeof TaxBracket.Type

export const BracketResult = Schema.Struct({
	bracket: TaxBracket,
	taxableAmount: CentsSchema,
	tax: CentsSchema,
})
export type BracketResult = typeof BracketResult.Type

export const TaxResult = Schema.Struct({
	jurisdiction: TaxJurisdiction,
	brackets: Schema.Array(BracketResult),
	totalTax: CentsSchema,
	taxableIncome: CentsSchema,
})
export type TaxResult = typeof TaxResult.Type

export const TaxBracketTable = Schema.Struct({
	jurisdiction: TaxJurisdiction,
	filingStatus: FilingStatus,
	standardDeduction: CentsSchema,
	brackets: Schema.Array(TaxBracket),
})
export type TaxBracketTable = typeof TaxBracketTable.Type

export class InvalidIncomeError extends Data.TaggedError("InvalidIncomeError")<{
	readonly income: number
}> {}

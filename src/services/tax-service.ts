import { Context, Effect, Layer } from "effect"
import { type Cents, multiply, sum } from "../domain/money"
import type { BracketResult, TaxBracketTable, TaxResult } from "../domain/tax"

export class TaxService extends Context.Tag("TaxService")<
	TaxService,
	{
		readonly computeTax: (params: {
			readonly grossIncome: Cents
			readonly table: TaxBracketTable
		}) => Effect.Effect<TaxResult>
	}
>() {
	static readonly layer = Layer.succeed(
		TaxService,
		TaxService.of({
			computeTax: ({ grossIncome, table }) =>
				Effect.gen(function* () {
					const taxableIncome = Math.max(0, grossIncome - table.standardDeduction) as Cents

					const bracketResults: Array<BracketResult> = []

					for (const bracket of table.brackets) {
						const upper = bracket.max ?? (Number.POSITIVE_INFINITY as Cents)
						const taxableInThisBracket = Math.max(
							0,
							Math.min(taxableIncome, upper) - bracket.min,
						) as Cents

						if (taxableInThisBracket <= 0) continue

						const tax = multiply(taxableInThisBracket, bracket.rate)

						bracketResults.push({
							bracket,
							taxableAmount: taxableInThisBracket,
							tax,
						})
					}

					const totalTax = sum(bracketResults.map((r) => r.tax))

					return {
						jurisdiction: table.jurisdiction,
						brackets: bracketResults,
						totalTax,
						taxableIncome,
					}
				}),
		}),
	)
}

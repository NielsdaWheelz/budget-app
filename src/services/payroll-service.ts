import { Context, Effect, Layer } from "effect"
import { type Cents, add, multiply, subtract, sum } from "../domain/money"
import type { PayrollRates, TakeHomePay } from "../domain/payroll"
import type { TaxBracketTable } from "../domain/tax"
import { TaxService } from "./tax-service"

export class PayrollService extends Context.Tag("PayrollService")<
	PayrollService,
	{
		readonly computeDeductions: (params: {
			readonly grossIncome: Cents
			readonly federalTable: TaxBracketTable
			readonly stateTable: TaxBracketTable
			readonly payrollRates: PayrollRates
			readonly healthInsurance: Cents
			readonly rentersInsurance: Cents
		}) => Effect.Effect<TakeHomePay>
	}
>() {
	static readonly layer = Layer.provide(
		Layer.effect(
			PayrollService,
			Effect.gen(function* () {
				const taxService = yield* TaxService

				return PayrollService.of({
					computeDeductions: ({
						grossIncome,
						federalTable,
						stateTable,
						payrollRates,
						healthInsurance,
						rentersInsurance,
					}) =>
						Effect.gen(function* () {
							const federalTax = yield* taxService.computeTax({
								grossIncome,
								table: federalTable,
							})

							const stateTax = yield* taxService.computeTax({
								grossIncome,
								table: stateTable,
							})

							const ssWages = Math.min(grossIncome, payrollRates.socialSecurityWageBase) as Cents
							const socialSecurity = multiply(ssWages, payrollRates.socialSecurityRate)

							let medicare = multiply(grossIncome, payrollRates.medicareRate)
							if (grossIncome > payrollRates.additionalMedicareThreshold) {
								const excess = subtract(grossIncome, payrollRates.additionalMedicareThreshold)
								medicare = add(medicare, multiply(excess, payrollRates.additionalMedicareRate))
							}

							const total = sum([
								federalTax.totalTax,
								stateTax.totalTax,
								socialSecurity,
								medicare,
								healthInsurance,
								rentersInsurance,
							])

							const netIncome = subtract(grossIncome, total)

							return {
								grossIncome,
								deductions: {
									federalIncomeTax: federalTax.totalTax,
									stateIncomeTax: stateTax.totalTax,
									socialSecurity,
									medicare,
									healthInsurance,
									rentersInsurance,
									total,
								},
								netIncome,
							}
						}),
				})
			}),
		),
		TaxService.layer,
	)
}

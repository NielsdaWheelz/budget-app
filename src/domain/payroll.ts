import { Schema } from "effect"
import { CentsSchema } from "./money"

export const PayrollRates = Schema.Struct({
	socialSecurityRate: Schema.Number,
	socialSecurityWageBase: CentsSchema,
	medicareRate: Schema.Number,
	additionalMedicareRate: Schema.Number,
	additionalMedicareThreshold: CentsSchema,
})
export type PayrollRates = typeof PayrollRates.Type

export const PayrollDeductions = Schema.Struct({
	socialSecurity: CentsSchema,
	medicare: CentsSchema,
	federalIncomeTax: CentsSchema,
	stateIncomeTax: CentsSchema,
	healthInsurance: CentsSchema,
	rentersInsurance: CentsSchema,
	total: CentsSchema,
})
export type PayrollDeductions = typeof PayrollDeductions.Type

export const TakeHomePay = Schema.Struct({
	grossIncome: CentsSchema,
	deductions: PayrollDeductions,
	netIncome: CentsSchema,
})
export type TakeHomePay = typeof TakeHomePay.Type

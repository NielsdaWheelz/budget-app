import { Schema } from "effect"

export const PersistedState = Schema.Struct({
	grossIncome: Schema.Number,
	healthInsurance: Schema.Number,
	rentersInsurance: Schema.Number,
	scenarioName: Schema.String,
	period: Schema.String,
	lineItemAmounts: Schema.Record({ key: Schema.String, value: Schema.Number }),
})
export type PersistedState = typeof PersistedState.Type

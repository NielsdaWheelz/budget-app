import { Schema } from "effect"
import { LineItemKey, LineItemKeySchema } from "./budget"
import { CentsSchema, fromDollars } from "./money"

export const ScenarioName = Schema.Literal("Solo", "OneRoommate", "MultiRoommates")
export type ScenarioName = typeof ScenarioName.Type

export const ScenarioOverride = Schema.Struct({
	key: LineItemKeySchema,
	amount: CentsSchema,
})
export type ScenarioOverride = typeof ScenarioOverride.Type

export const Scenario = Schema.Struct({
	name: ScenarioName,
	overrides: Schema.Array(ScenarioOverride),
})
export type Scenario = typeof Scenario.Type

export const SCENARIOS: ReadonlyArray<typeof Scenario.Type> = [
	{
		name: "Solo",
		overrides: [
			{ key: LineItemKey("Rent"), amount: fromDollars(3200) },
			{ key: LineItemKey("Internet"), amount: fromDollars(100) },
		],
	},
	{
		name: "OneRoommate",
		overrides: [
			{ key: LineItemKey("Rent"), amount: fromDollars(1600) },
			{ key: LineItemKey("Internet"), amount: fromDollars(50) },
		],
	},
	{
		name: "MultiRoommates",
		overrides: [
			{ key: LineItemKey("Rent"), amount: fromDollars(1067) },
			{ key: LineItemKey("Internet"), amount: fromDollars(33) },
		],
	},
]

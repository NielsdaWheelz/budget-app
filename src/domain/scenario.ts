import { Schema } from "effect"
import { LineItemKey, LineItemKeySchema } from "./budget"
import { type Cents, multiply } from "./money"

export const ScenarioName = Schema.Literal("Solo", "OneRoommate", "MultiRoommates")
export type ScenarioName = typeof ScenarioName.Type

export const ScenarioSharedItem = Schema.Struct({
	key: LineItemKeySchema,
	divisor: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)),
})
export type ScenarioSharedItem = typeof ScenarioSharedItem.Type

export const Scenario = Schema.Struct({
	name: ScenarioName,
	sharedItems: Schema.Array(ScenarioSharedItem),
})
export type Scenario = typeof Scenario.Type

export const SCENARIOS: ReadonlyArray<typeof Scenario.Type> = [
	{
		name: "Solo",
		sharedItems: [],
	},
	{
		name: "OneRoommate",
		sharedItems: [
			{ key: LineItemKey("Rent"), divisor: 2 },
			{ key: LineItemKey("Internet"), divisor: 2 },
		],
	},
	{
		name: "MultiRoommates",
		sharedItems: [
			{ key: LineItemKey("Rent"), divisor: 3 },
			{ key: LineItemKey("Internet"), divisor: 3 },
		],
	},
]

const scenarioDivisor = (scenario: Scenario, key: LineItemKey): number =>
	scenario.sharedItems.find((item) => item.key === key)?.divisor ?? 1

export const applyScenarioShare = (amount: Cents, scenario: Scenario, key: LineItemKey): Cents =>
	multiply(amount, 1 / scenarioDivisor(scenario, key))

export const removeScenarioShare = (amount: Cents, scenario: Scenario, key: LineItemKey): Cents =>
	multiply(amount, scenarioDivisor(scenario, key))

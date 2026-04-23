import { Context, Effect, Layer } from "effect"
import type { LineItem } from "../domain/budget"
import type { Scenario } from "../domain/scenario"

export class ScenarioService extends Context.Tag("ScenarioService")<
	ScenarioService,
	{
		readonly applyScenario: (params: {
			readonly baseItems: ReadonlyArray<LineItem>
			readonly scenario: Scenario
		}) => Effect.Effect<ReadonlyArray<LineItem>>
	}
>() {
	static readonly layer = Layer.succeed(
		ScenarioService,
		ScenarioService.of({
			applyScenario: ({ baseItems, scenario }) =>
				Effect.gen(function* () {
					const overrideMap = new Map(scenario.overrides.map((o) => [o.key, o.amount]))

					return baseItems.map((item) => {
						const overrideAmount = overrideMap.get(item.key)
						if (overrideAmount !== undefined) {
							return { ...item, amount: overrideAmount }
						}
						return item
					})
				}),
		}),
	)
}

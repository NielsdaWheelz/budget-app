import { Context, Effect, Layer } from "effect"
import type { LineItem } from "../domain/budget"
import { type Scenario, applyScenarioShare } from "../domain/scenario"

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
					return baseItems.map((item) => {
						return { ...item, amount: applyScenarioShare(item.amount, scenario, item.key) }
					})
				}),
		}),
	)
}

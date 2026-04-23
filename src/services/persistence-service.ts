import { KeyValueStore } from "@effect/platform"
import { Context, Effect, Layer, Option } from "effect"
import { PersistedState } from "../domain/persistence"

const STORAGE_KEY = "budget-state"

export class PersistenceService extends Context.Tag("PersistenceService")<
	PersistenceService,
	{
		readonly load: Effect.Effect<PersistedState | null>
		readonly save: (state: PersistedState) => Effect.Effect<void>
	}
>() {
	static readonly layer = Layer.provide(
		Layer.effect(
			PersistenceService,
			Effect.gen(function* () {
				const store = (yield* KeyValueStore.KeyValueStore).forSchema(PersistedState)
				return {
					load: Effect.gen(function* () {
						const option = yield* Effect.catchAll(store.get(STORAGE_KEY), () =>
							Effect.succeed(Option.none<PersistedState>()),
						)
						return Option.getOrNull(option)
					}),
					save: (state) => Effect.catchAll(store.set(STORAGE_KEY, state), () => Effect.void),
				}
			}),
		),
		KeyValueStore.layerStorage(() => localStorage),
	)
}

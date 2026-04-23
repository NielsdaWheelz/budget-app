# Effect

## Scope

This document covers repository-wide Effect usage and Effect-native programming style.

## Rules

- Use functions that return `Effect` when a function can fail in a handleable way or performs asynchronous work.
- Prefer Effect-native APIs and patterns unless a boundary clearly requires another shape.
- When in doubt, prefer the Effect-native shape.

## Fibers

- Every forked fiber must have its termination propagated.
- Avoid bare `forkScoped`, `forkDaemon`, and `forkChild`. Any use must include `justify-fork`.
- Express concurrent background work as plain `Effect<never, E, R>` values rather than forking internally.
- Compose concurrent background work at the call site so concurrency and error propagation are handled together.
- In streams, use `propagateInterrupt` to bind background work to the stream lifecycle.
- In effects, use plain effect composition such as `Effect.raceFirst` or `Effect.all({ concurrency: "unbounded" })`.
- Queue-based stream operators that need a forked producer should use `streamFromForkedProducer`.
- Dynamic concurrent work that must outlive its trigger should use `FiberSet` or `FiberMap`.
- Prefer `FiberMap` when keyed deduplication is required.
- Every fork site must document its termination-propagation mechanism.

## Scope-Bound Values

- Do not let values produced by scoped effects escape their scope.
- Keep scoped value creation and use within the same scope.
- Do not return scoped values, store them in `Ref` or closures, or pass them to long-lived fibers.
- `Effect.provide(layer)` creates a scope around the wrapped effect.
- If `Effect.provide(layer)` wraps acquisition but not use, the value may outlive its resources.
- When a value depends on scoped resources, `Effect.provide(layer)` must wrap both acquisition and use.

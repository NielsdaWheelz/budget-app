# Control Flow

## Scope

This document covers exhaustive branching and race-safety rules.

## Exhaustiveness

- When branching on a value with a known finite set of possibilities, use exhaustive matching. That means that adding a new possibility to the producer of the value should cause a type error in the consumer until it explicitly handles that possibility. If new possibilities cound possibly be added to the consumer without creating type errors, this rule has been violated.
- Good patterns:
  - `Match.exhaustive` is the standard Effect pattern for exhaustive matching.
  - `absurd` is the standard runtime exhaustiveness check for unreachable branches.
  - `satisfies` is the standard compile-time assertion for narrowed finite variants.
- This applies to errors as well. Do not erase finite error channels with catch-all handlers such as `orDie`, `Effect.ignore`, or `catchAll(() => Effect.void)`.
- Usually, the best way to handle errors is with `catchTags`.

## Races

- Do not race an effect that performs a destructive or non-idempotent operation unless losing the result is acceptable.
- `Effect.raceFirst` and `Effect.race` discard the losing result.
- If the losing effect performed an irreversible side effect, the side effect is committed but the result is lost.
- When concurrent effects need to coordinate around destructive operations, route signals through a single serialization point.

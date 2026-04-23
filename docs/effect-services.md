# Effect Services

## Scope

This document covers how repository modules should divide functionality between Effect services and helpers.

## Rules

- Default to pure helpers when behavior can be externalized without exposing additional service internals or hidden runtime wiring.
- Prefer a semantic service seam when other modules may depend on the behavior, state, or infrastructure boundary.
- Do not export reusable helpers, `Effect` values, or catalog entries that inline-close another module's service-private dependencies with ad hoc `Effect.provide(Service.layer)` wiring.
- Service-private wiring belongs at the owning self-wired service layer.
- `withSelfService(...)` belongs at process or adapter edges, explicit handle factories, or other execution boundaries where choosing the canonical runtime internally is the point.
- Reusable domain and admin APIs that other services may depend on should expose a semantic service or handle boundary rather than hiding inspection or runtime services behind exported helper functions.
- If a workflow family grows large, split it into smaller self-wired sub-services rather than reintroducing exported open helpers or closure-factory wiring.

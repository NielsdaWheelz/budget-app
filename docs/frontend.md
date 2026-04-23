# Frontend

## Scope

This document covers browser-facing frontend code under `src/web/` and any future Solid TSX files introduced elsewhere in the repo. We use SolidJS.

## State

- App-owned empty component state uses `null`.
- Do not use magic sentinels such as `""`, `0`, `-1`, or ad-hoc placeholder values to mean absence, idle state, or none.
- Empty draft text is not semantic absence. `""` is valid for raw input state only; semantic absence should be `null` or an explicit typed variant.
- `boolean` is only for genuine yes/no state. Do not use `false` to stand in for “no current `T`”.
- `undefined` is for framework or interop absence, not app-owned absence.
- Normalize framework or browser absence into app-owned state immediately unless there is a strong reason not to. See [boundaries.md](boundaries.md) for the general ingress rule.
- Do not store `Option` in local component state.
- Prefer derived state over duplicated state.

## Variants

- Keep expected control-flow variants explicit.
- For enum casing and exhaustiveness, follow [naming.md](naming.md) and [control-flow.md](control-flow.md).
- Omission is the default. Do not add `"Default"`-style variants unless they represent real logic distinct from absence.
- Optional variant props include `| undefined`.
- Unexpected UI invariants should fail loudly.

## Boundaries

- Map domain and RPC errors to UI messages in one helper near the screen boundary. Name these helpers `*ErrorMessage` and match exhaustively on `_tag`.
- External strings keep external spelling.
- Product-facing operational names use the current product brand unless the boundary explicitly requires another spelling.

## Routing and Data

- Navigable frontend context belongs in the URL.
- Route-entry state belongs to the router, not component effects or ambient browser reads during execution.
- Use router loaders for route entry. Inside an already-valid route, use the standard query/loading primitive for reactive component-local queries and explicit async handlers or signals for mutations and one-off actions.

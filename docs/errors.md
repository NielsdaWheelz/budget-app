# Errors

## Scope

This document covers error and defect modeling, `null` normalization, and runtime invariant checks.

## Errors and Defects

- Construct an error type only in the code that detects the condition it represents.
- When branching on an error, consume the original error type completely and replace it with distinct branch-specific types.
- Use errors for expected, modelable failures.
- Use defects for broken invariants, impossible states, internal corruption, schema or code mismatch, and similar “should never happen” conditions.
- Persistent failure of a dependency beyond its applicable retry budget is a defect by default.
- Classify persistent dependency failure by the invariant or result the owning operation is expected to establish when our code and its dependencies are operating correctly.
- Do not downgrade a persistent dependency outage to a normal product-facing error just because the current feature or request can continue without success.
- Do not invent synthetic product-facing "Unavailable", "TransientFailure", or similar middle-ground errors for a required dependency unless persistent dependency unavailability is itself an intended modeled outcome.
- Do not classify provider failures into domain errors by coarse HTTP class or transport shape alone.
- Only map a provider response to a modeled domain error when the provider contract or our adapter normalization identifies that exact condition.
- Unknown non-transient provider failures defect.
- Only treat retry exhaustion as a handleable error when dependency unavailability is itself part of the operation's intended modeled outcome.
- Handle errors as deeply as possible and propagate them upward only when needed.
- Defects are not normal application control flow.
- Do not convert defects into UI states, retryable business branches, persisted domain status fields, or other product-facing recovery paths.
- Do not mask unexpected internal failures with synthetic fallback output, placeholder summaries, or "best effort" persisted state just to keep a workflow moving.
- Observing a defect in production should trigger a code or operational change.
- Any intentional defect classification must include `justify-defect`.
- Any branch that discards an error must first narrow it to a named or tagged error and include `justify-ignore-error`.

## `null`

- Do not use `T | null` or `Option<T>` in service or domain APIs to represent absence that still requires classification.
- Classify such absence immediately as a typed error or a defect.
- Raw `null` is only for foreign interfaces we do not control.
- Normalize raw nullable input at the boundary. See [boundaries.md](boundaries.md) for the general ingress rule.
- Use `Option<T>` when optionality is itself the successful result.
- Use a typed error when absence is an expected application-level failure.
- Use a defect when absence violates an invariant.
- Our own helpers, services, and internal state should not accept or return raw `null` unless interop makes a better representation materially worse.

## Service Invariants

- Represent parameter validity in types, brands, and parsed canonical values.
- If malformedness is knowable locally, validate once into an owned type, brand, or parsed canonical value and carry that type through the system.
- Do not hide local representability checks inside render, quote, or encode helpers.
- Renderers, quoters, and encoders should assume already-owned local types and only perform boundary-specific escaping or formatting.
- Do not use runtime service-boundary guards for parameter validity that should be encoded in types or brands.
- Runtime checks in service code should enforce remaining invariants that cannot be expressed cleanly in the type system.
- Such checks must include `justify-service-invariant-check` explaining why the invariant is not represented in types, brands, or parsed canonical values.
- Violations of such invariants are defects.

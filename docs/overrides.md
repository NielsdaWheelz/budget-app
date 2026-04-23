# Overrides

## Scope

This document covers justified escape hatches in source code: overrides, intentionally retained dead code, and type assertions.

## Overrides

- Every `// @ts-*` comment must include `justify-ts-override`.
- Every `// eslint-*` comment must include `justify-eslint-override`.
- Every `// biome-ignore` comment must include `justify-biome-override`.

## Dead Code

- Delete dead code by default.
- If an exported symbol is intentionally kept without current call sites because we expect to want it again soon, justify it with `justify-dead-code`.

## Type Assertions

- Every type assertion except `as const` must include `justify-type-assertion`.
- `justify-type-assertion` must explain why the cast is safe and why a safer typing approach is not feasible.

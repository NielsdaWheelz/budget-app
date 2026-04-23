# Keys And Identities

## Scope

This document covers identity and authority naming, branding, sealing, and related naming rules.

## Id

- Meaningless private identity should use UUID-backed `*Id` values.
- `*Id` means private meaningless identity.
- Do not expose `*Id` directly at end-user boundaries.

## Key

- Meaningful identity should use `*Key` values.
- Prefer structured `Schema.Json` keys for meaningful identity.
- Do not pass raw anonymous `Schema.Json` for owned meaningful identity.
- Give owned structured keys a named type and `*Schema`.
- Do not replace meaningful identity with meaningless UUIDs just because it identifies something.
- Use `jsonKeyToString` only when a boundary genuinely requires a canonical string form of a structured key.
- Do not use `jsonKeyToString` as a default persistence format.

## Spec

- `*Spec` means a structured semantic description, not private identity.
- Use `*Spec` when the full structured value is the thing that should be selected, persisted, or compared.
- If a boundary needs stable meaningful identity for a spec, derive a `*Key` from the spec rather than calling the spec an `*Id`.
- Persist the structured spec itself when instances must stay locked to their selected terms even if a live catalog later changes.

## Handle

- `*Handle` means outward opaque identity.
- Handles are sealed outward forms of internal identity.
- Non-admin product boundaries prefer handles for outward opaque identity.
- Do not call an outward handle `id`.
- Outward opaque identity should be named as a handle at boundary surfaces.

## Token And ApiKey

- `*Token` and `*ApiKey` mean outward bearer or capability strings.
- Tokens and API keys are authority, not identity pointers.

## Ref

- `*Ref` is only for lower-layer references such as provider-owned or infrastructure-owned pointers.
- Do not use `*Ref` for outward opaque values.
- Do not use `*Ref` for DTO wrappers.

## Specific Names

- Prefer the most specific honest domain name.
- `Id`, `Key`, `Handle`, `Token`, `ApiKey`, and `Ref` are fallback categories, not the only allowed names.
- Prefer a sharper domain term when it captures the semantics more directly than a generic suffix.
- Use the same specific name across boundaries when the concept itself is the same.
- A specific name should still respect the underlying semantics of the fallback category it replaces.

## Brands

- Use validated brands plus `*Schema` for canonical values whose malformedness is knowable locally.
- Use nominal brands for provenance-backed internal IDs, outward handles, outward tokens, and lower-layer refs.
- Outward sealed handles and tokens may extend a validated local wire-text type such as `SealedRefText`.
- Use owned named types and `*Schema` for semantic structured values rather than passing raw anonymous `Schema.Json`.
- Add branding when the semantics need nominal distinction beyond the structure itself.
- For canonical owned values, prefer a shared `parseX` and `assumeX` pair next to the owning type.
- `parseX` may normalize once at ingress, then validate and return the canonical owned value. See [boundaries.md](boundaries.md) for the general ingress rule.
- `assumeX` requires the value to already be canonical and defects otherwise.
- Do not use `parseX` naming for helpers that convert outward opaque handles or tokens into internal identity or authority. Use names such as `unsealX` or `resolveX`.

## Sealing

- Seal outward opaque identity by default at non-admin product boundaries.
- User-controlled infrastructure is a product boundary.
- Service-to-service product RPC boundaries should also prefer handles rather than exposing private IDs directly.
- Admin and debug surfaces may expose raw private IDs or tokens when inspection is the point.
- Intentional short aliases to handles, such as `WorkspaceRef`, are allowed when the purpose is a shorter pointer to a sealed handle rather than direct exposure of private identity.
- Intentional bootstrap capability tokens, such as `WorkerToken`, are allowed to stay raw when the token itself is the authority and must exist before persistence.
- Internally, always use private IDs and internal references.
- Successful unseal or resolve is what converts an outward handle or token into the owning internal type.
- Typed web and RPC schemas may validate outward sealed wire text as `SealedRefText` at the boundary, but entity-specific unseal or resolve still happens later.
- Entity-specific `unsealX` and `resolveX` helpers own classification and conversion from outward wire text into private internal types.
- Raw unsealed strings must not escape boundary helpers.
- RPC and web transport schemas may carry typed outward handles and tokens, but they should not unseal directly into private IDs during decode.
- Handler and service code owns unseal, classification, and conversion from malformed outward values into domain errors.
- If an outward opaque value wraps UUID-backed identity, prefer `sealId` and `unsealId`.
- If an outward opaque value must wrap meaningful structured identity, seal a canonical JSON string or buffer rather than inventing an ad hoc string encoding.

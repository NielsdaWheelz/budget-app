# Tagged Unions

## Scope

This document covers `_tag` versus domain-record shapes.

## Rules

- Use `_tag` when a value's primary meaning is one variant of a sum type.
- Use semantic fields such as `provider`, `status`, `kind`, `role`, or `state` when a value is primarily a domain record.
- Persisted data, RPC DTOs, and cross-module boundary records look like domain data rather than type-system artifacts.
- When a semantic field selects the schema of a subfield within one domain record, prefer that semantic field over `_tag`.
- Use `_tag` at a boundary only when the boundary value itself is fundamentally a tagged union.
- Use flat payloads when one layer consumes the whole variant payload and there is no meaningful internal grouping.
- Use nesting when different layers own different parts of the value.
- Do not add a nested discriminator unless the nested value is itself a real union.

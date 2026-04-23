# JSON Values

## Scope

This document covers structured JSON values.

## Rules

- Keep semantically structured JSON as `Schema.Json` in code and RPC or web DTOs rather than stringifying it.
- Persist structural JSON in PostgreSQL `jsonb`, not `text`.
- At the PostgreSQL boundary, represent `json` and `jsonb` columns as `PgJson<Schema.Json>` so SQL `NULL` stays distinct from JSON `null`.
- Wrap outgoing bind values with `pgJson` or `pgJsonValues`.
- Unwrap or schema-decode `PgJson` values at the query boundary when the distinction is no longer needed. See [boundaries.md](boundaries.md) for the general boundary conversion rules.
- Do not use `===`, `!==`, or `Object.is` for potentially structural JSON values.
- Narrow to primitives first when that is the intent.
- Otherwise use `jsonEqual` for structural equality.
- For structural equality and dedupe in JavaScript collections, use helpers such as `jsonEqual` and `distinctJsonValues`.

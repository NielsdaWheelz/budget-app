# Codebase

## Scope

This document covers the tech stack, repository-wide code organization, imports, generated files, and module boundary rules.

## Tech Stack

- Use Bun instead of Node, npm, pnpm, or npx.
- Use PostgreSQL for all data storage.

## Environment

- Keep `.env.example` in sync with every added, removed, or renamed environment variable.
- Every environment variable read by source code must appear in `.env.example`.
- Each environment variable in `.env.example` must state whether it is required or optional, and its default if it has one.

## Entrypoints

- Entrypoints should live in `bin` directories.
- Only entrypoints should have side effects.
- It is fine to colocate server and client helpers in one module as long as browser-facing imports use only browser-safe exports.

## Imports

- Relative imports may go up at most two levels.
- If a relative import would start with `../../../`, use a self-referential import instead.
- Do not re-export symbols from other modules. Import each symbol from its defining module.

## Module Files

- Do not create `index.ts` files because they make relative and self-referential imports asymmetric.
- If a module has multiple files and there is some kind of "main" one or primary interface, call it `main.ts`.
- If a module has one file, don't nest a single file in a directory. Just name the file `module-name.ts`.

## Generated Files

- Commit `routeTree.gen.ts` files.

## Host And Target Languages

- TypeScript is the host language for application logic.
- SQL, shell, and other emitted code are target languages that run in other runtimes.
- Prefer business rules, branching, fallback policy, and domain invariants in TypeScript whenever reasonably possible.
- Use target-language code when the target runtime is the natural owner of the work, not just because the expression is shorter there.
- Keep SQL focused on database-shaped work such as set filtering, joins, ordering, aggregation, and atomic mutations.
- Keep shell focused on process and OS orchestration.

## Module Boundaries

- A module is any directory.
- `src/framework/...` is reusable framework substrate used by product modules.
- `src/framework/...` must not import product modules such as `src/auth/...`, `src/main/...`, `src/cloud/...`, `src/executor/...`, build tooling under `src/scripts/...`, or app code under `src/web/...`.
- External functionality may be consumed by any module.
- Internal functionality is only for a module and its submodules.
- Default to internal unless functionality is clearly consumed externally.
- `.../internal/...` marks internal code.
- `.../-internal/...` is the route-tree-safe form of `internal/` with the same boundary semantics.
- `.../server/...` marks server-only code.
- `.../web/...` marks code that exists because the module has a browser-facing UI (including server code that is only used to support the web UI).
- Browser-facing UI support code should have `web` somewhere in its path.
- Outside `server/`, `web/` is the module-owned web surface shared by browser code and server code (except `src/web/...`).
- Inside `server/`, `web/` is server-side web support code.
- `src/framework/web/...` is shared browser substrate for the apps, not an app in itself.
- `src/web/...` is frontend/browser code.

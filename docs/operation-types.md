# Operation Types

## Scope

This document covers the coordination operation type system, entry point and composition patterns, replay identity, and durable operations.

## Purpose

Mutating operations can be interrupted by retries, timeouts, and crashes. A later attempt must finish the same operation without double-applying side effects or drifting to a different result.

Coordination operations make this resumable. Every effectful operation in the codebase is wrapped in an operation type that declares its replay characteristics, composes safely with other operations, and enforces correctness invariants through Effect's `R` parameter at compile time.

## Context Markers

Coordination operations use a small set of compile-time markers:

- `OperationScope` -- we are inside any coordination operation.
- `MutationScope` -- mutation `Flow.call(...)` composition is permitted.
- `DurableScope` -- durable multi-step composition is permitted.

Common public aliases:

- `MutationOperationContext = OperationScope | MutationScope`
- `DurableMutationContext = MutationOperationContext | DurableScope`

These are positive capability markers. Query composition gets `OperationScope` only; mutation composition gets `MutationOperationContext`; durable workflow bodies get `DurableMutationContext`.

Framework internals also use one stronger marker:

- `MultiMutationScope` -- internal marker used to distinguish multi-mutation bodies from single-mutation bodies. It remains part of the enforcement model, but ordinary domain code should not need to mention it directly.

There is also one important negative marker:

- `LeafBodyScope` -- blocks managed `Flow.call(...)` and `.run*()` inside leaf bodies such as `SingleMutation.db(...)`, `UnreplayableQuery.db(...)`, `UnreplayableSingleMutation.external(...)`, and `SingleMutation.rpc(...)`.

Replay paths, step-key counters, and single-mutation guards are internal runtime state, not public scope markers.

Coordination wrappers may spend protocol-owned internal mutation steps, but
they must not silently change the wrapped user body's mutation-cardinality
contract. A single-mutation body stays single-mutation; a multi-mutation body
stays multi-mutation.

## Operation Types

Operation types, ordered from lightest to heaviest:

| Type | Purpose | Replayable | Edge-runnable | Side effects |
|---|---|---|---|---|
| `PureQuery` | A deterministic, side-effect-free computation | not needed | yes | none |
| `UnreplayableQuery` | A simple read | no | yes | read-only |
| `UnreplayableQueryStream` | A simple read returning a stream | no | yes | read-only (stream) |
| `UnreplayableSingleMutation` | A one-shot state change that cannot be replayed | no | yes | at most 1 |
| `UnreplayableMultiMutation` | An opaque multi-step execution with no replay key | no | yes | multiple |
| `ReplayableQuery` | A read whose result can be cached for replay | yes | yes | read-only |
| `ReplayableSingleMutation` | A single atomic state change | yes | yes | at most 1 |
| `ReplayableMultiMutation` | A multi-step workflow (multiple state changes) | yes | no | multiple |
| `DurableOperation` | A multi-step workflow with autonomous completion | yes | yes | multiple (presented as 1) |

Column definitions:

- **Replayable**: retrying with the same replay key produces the same observable result without re-applying side effects.
- **Edge-runnable**: whether the operation can be run directly at entry points.
- **Side effects**: how many independent side effects (crash-separable commits or external calls) the operation may perform. Read-only operations perform none.

## Operation Details

### `PureQuery`

A deterministic, side-effect-free computation (`R = never`). Always produces the same result for the same input. Not memoized because determinism makes it unnecessary. Does not consume a step key.

- **`PureQuery.effect(body)`** -- wraps a pure effect so it can participate in the `Flow.call(...)` pattern inside composed flows.
  - Body contains: pure computation and `Flow.call(...)` on other pure queries. No services and no I/O.

### `UnreplayableQuery`

A read that may return different results each time. The simplest operation type.

- **`UnreplayableQuery.effect(body)`** -- a read with no transaction.
  - Body contains: read-only operations and control flow.
- **`UnreplayableQuery.db(body)`** -- a read inside a SERIALIZABLE read-only transaction.
  - Body contains: read-only SQL and control flow.
- **`UnreplayableQuery.compose(flow)` / `UnreplayableQuery.gen(...)`** -- an unreplayable read built by orchestrating other operations.
  - Flow contains: `Flow.call(...)` on queries and control flow. No direct side effects.

### `UnreplayableQueryStream`

A read that returns a stream of values rather than a single result.

- **`UnreplayableQueryStream.effect(body)`** -- a read that produces a `Stream` instead of a single value.
  - Body contains: read-only operations and control flow. The setup effect yields the stream; the scope covers both the setup effect and the resulting stream.
- **`UnreplayableQueryStream.compose(flow)` / `UnreplayableQueryStream.gen(...)`** -- a stream-producing read built by orchestrating other operations.
  - Flow contains: `Flow.call(...)` on queries and control flow. No direct side effects.
- `Flow.call(queryStream)` opens the stream inside an existing managed flow and returns it as an `Effect` result.
- `Operation.runQuery(queryStream)` flattens the setup effect for edge streaming handlers.

### `UnreplayableSingleMutation`

A one-shot state change with no guarantees if interrupted. If it crashes partway through, there is no automatic recovery or replay.

- **`UnreplayableSingleMutation.db(body)`** -- a DB write with no replay or memoization.
  - Runs in a SERIALIZABLE transaction.
  - Body contains: SQL reads, writes, and control flow.
- **`UnreplayableSingleMutation.effect(body)`** -- a raw-effect unreplayable mutation.
  - Use for callback or adapter boundaries that must stay in ordinary `Effect` code but still need managed-operation capabilities already present in `R`.
  - Edge execution still enforces the same at-most-one-mutation rule as `SingleMutation.compose(...)`.
- **`UnreplayableSingleMutation.external(body)`** -- a non-DB external call such as an API call to a third-party service.
  - No transaction and no retry.
  - Strict leaf form of `UnreplayableSingleMutation.effect(...)`: provides `LeafBodyScope`, so the body cannot nest managed operations.
  - Body contains: a single external call.
- **`UnreplayableSingleMutation.compose(flow)` / `UnreplayableSingleMutation.gen(...)`** -- an unreplayable mutation built by orchestrating other operations.
  - Flow contains: `Flow.call(...)` on queries and at most one mutation `Flow.call(...)`.

### `UnreplayableMultiMutation`

An opaque unreplayable execution region that may perform multiple managed mutation calls internally but has no replay key and no resumable replay semantics.

- **`UnreplayableMultiMutation.effect(body)`** -- a raw-effect opaque unreplayable execution.
  - Use for adapter or runtime regions that must stay in ordinary `Effect` code but may call multiple managed mutations internally.
- **`UnreplayableMultiMutation.compose(flow)` / `UnreplayableMultiMutation.gen(...)`** -- an opaque unreplayable execution built from `Flow`.
  - Flow contains: `Flow.call(...)` on queries and any number of mutations.

### `ReplayableQuery`

A read whose result is stable across replays. Asking the same question twice during a retry gives the same answer.

- **`Query.effect(schemas, body)`** -- a read with exit schemas so the result can be serialized for replay.
  - Body contains: read-only operations and control flow.
- **`Query.db(schemas, body)`** -- same, inside a SERIALIZABLE read-only transaction.
  - Body contains: read-only SQL and control flow.
- **`Query.from(query, schemas)`** -- upgrades an existing `UnreplayableQuery` by adding exit schemas.
- **`Query.materializing(mutation)`** -- adapts a convergent `ensure...`-style `ReplayableSingleMutation` into a query-shaped operation.
  - Use only when the wrapped mutation's purpose is to lazily materialize local state required to answer a read.
  - In query frames it runs the wrapped mutation through its internal unreplayable terminal path.
  - In mutation frames it still counts as a mutation call and preserves the caller's mutation-cardinality semantics.
- **`Query.compose(flow)` / `Query.gen(...)`** -- a read built by orchestrating other operations.
  - Flow contains: `Flow.call(...)` on queries and control flow. No direct side effects.
- **`toctouQuery({ check, operation })`** -- a TOCTOU-safe check-act-recheck read.
  - `check`: a `ReplayableQuery` that returns `Proceed(value)` or `Return(result)`. `operation`: a factory from the proceed value to a `ReplayableQuery` that returns `Return(result)` or `Recheck`. On `Recheck`, the check is re-run.

### `ReplayableSingleMutation`

A state change that completes exactly once, even across crashes and retries.

- **`SingleMutation.db(schemas, body)`** -- a single atomic DB write.
  - Runs in a SERIALIZABLE transaction. Results are cached for crash recovery.
  - Body contains: SQL reads, writes, and control flow. No `Flow.call(...)` on managed operations.
- **`SingleMutation.idempotentExternal(unreplayableMutation, { success, error? })`** -- memoizes an external or interop unreplayable mutation whose exact replay is already correct.
  - Use this when replay may issue the same external call again with identical input and that is an intended correctness property, not merely a tolerated duplicate.
  - Once the first exit is durably memoized, later replays no longer depend on provider-side idempotency retention.
  - If the process dies after the side effect happened but before the memoized exit is durably recorded, replay may execute the wrapped mutation again. That replay must still be correct.
- **`SingleMutation.rpc(fn)`** -- a mutation that crosses a service boundary via RPC.
  - Auto-generates a replay key that stays stable on replay and retries transport errors.
- **`SingleMutation.compose(flow)` / `SingleMutation.gen(...)`** -- a mutation built by orchestrating other operations.
  - Flow contains: `Flow.call(...)` on queries and at most one mutation `Flow.call(...)`.
- **`uncertainMutation(unreplayableMutation, { success, error? })`** -- wraps one unreplayable transition with crash detection.
  - Keeps the wrapped mutation's normal single-mutation semantics. Returns `Confirmed<A>` on success and `Unknown` on ambiguous crash recovery.
  - Use `stabilizeMutation(...)` only when a replayable query can authoritatively prove the effect. Otherwise, inspect `Confirmed` versus `Unknown` explicitly inside a larger workflow and resolve that uncertainty before returning from the owning operation.
  - `Unknown` is an internal coordination state, not a normal product-facing outcome. Retry, reconcile, or classify a terminal modeled failure internally; if that process exhausts first, defect.
- **`unsafeMayDuplicateExecutionMemoizedMutation(unreplayableMutation, { success, error? })`** -- memoizes an unreplayable mutation's final exit value without crash-detection markers.
  - Use this only when duplicate execution is an explicitly accepted tradeoff. If the process dies after the side effect happened but before the memoized result is durably recorded, replay may execute the wrapped mutation again.
  - This only changes crash semantics. It does not justify surfacing transient dependency failures directly. Retry transient failures internally when the owning operation still expects to succeed, and defect on retry exhaustion by default.
- **`uncertainExecution(execution, { success, error? })`** -- wraps an `UnreplayableMultiMutation` with the same crash-detection protocol.
  - Use this for cases like script or tool execution where the body may perform multiple managed mutation calls and returns `Completed<A>` or `UnknownOnCrash`.
- **`stabilizeMutation({ query, mutation, reconcileSchedule, retrySchedule, consistency })`** -- stabilizes an uncertain mutation into a deterministic outcome.
  - `query`: a `ReplayableQuery` that checks whether the mutation's effect is already visible. `mutation`: an `UncertainMutation`. Checks whether the effect is already complete, executes if not, then retries or reconciles on `Unknown` until the outcome is proved or the retry budget is exhausted.
  - Retry or reconciliation exhaustion is a defect unless the owning operation intentionally models persistent dependency unavailability as a first-class outcome.
- **Choosing an external-mutation wrapper**
  - Use plain `retryOrDie*` around the leaf when transient provider failure should just retry and no crash-ambiguity protocol is needed.
  - Use `SingleMutation.idempotentExternal(...)` when exact replay of the same external call is already correct and local memoization is there to stop depending on the provider retaining that capability forever.
  - Use `unsafeMayDuplicateExecutionMemoizedMutation(...)` when duplicate execution is an accepted domain tradeoff and there is no worthwhile authoritative recovery path.
  - Use `uncertainMutation(...)` plus `stabilizeMutation(...)` when a replayable query can authoritatively prove the effect after an ambiguous external transition.
  - If none of those fits cleanly, the operation likely needs more explicit domain recovery logic rather than a softer error surface.
- **Mutation naming rule** -- strict mutation semantics are the default.
  - Prefer names where success means this call actually performed a new state transition.
  - A pre-existing effect becomes `MutationAlreadyComplete`; callers should catch that only when "already done" is a legitimate domain outcome.
  - If a mutation instead converges on an outcome and treats an already-existing outcome as normal rather than error, name it `ensure...`.
  - If you intentionally want convergent semantics, implement them explicitly at the domain boundary. Do not hide them behind a generic helper.
- **`linearizeSingleMutation(conflictKey, mutation)`** -- serializes concurrent single-step mutations on the same conflict key through a short-lived live lock on the shared exclusivity keyspace.
- **`toctouMutation({ check, operation })`** -- a TOCTOU-safe check-act-recheck mutation for replayable mutation contexts.
  - Same shape as `toctouQuery`, but `operation` returns a `ReplayableSingleMutation`. The first check is memoized for stable input across replays.

### `ReplayableMultiMutation`

Multiple independently committed state changes that must be driven to completion in order, but span more than one transaction or system.

- **`MultiMutation.compose(flow)` / `MultiMutation.gen(...)`** -- a multi-step workflow built by orchestrating other operations.
  - Flow contains: `Flow.call(...)` on any number of queries and mutations.
  - Use this when the work cannot honestly be one DB commit. If one SERIALIZABLE transaction is enough, keep it as `SingleMutation.db(...)`.
  - Not an edge entrypoint by itself. Use it as a reusable subworkflow inside another durable flow, or wrap it with `createDurableOperation(...)` when you want a named recoverable edge workflow.
- **`linearizeMultiMutation(conflictKey, mutation)`** -- serializes a durable multi-step workflow on a conflict key through the internal replay-aware exclusivity protocol.
  - Intended for correctness boundaries that must survive crash or replay, such as "read current state, perform external side effect, then persist resulting state".

### `DurableOperation`

A multi-step workflow that will run to completion on its own, even if the original caller crashes.

- **`createDurableOperation(options, (payload) => OperationFlow)`** -- a named, recoverable multi-step workflow.
  - If the process crashes mid-execution, orphaned work is picked up and replayed to completion.
  - Provides three execution modes: `DurableOperation.execute(payload)(handle)` for foreground execution, `DurableOperation.submit(payload)(handle)` for fire-and-forget execution, and `Flow.call(handle, payload)` for inline composition within a parent durable operation.
  - `DurableOperation.execute(payload)(handle)` cannot be called inside a durable operation. `DurableOperation.submit(payload)(handle)` and `Flow.call(handle, payload)` can.

### In-Transaction Helpers

For composing reads and writes within a `SingleMutation.db(...)`, `UnreplayableQuery.db(...)`, or `UnreplayableSingleMutation.db(...)` body:

- **`createDbQueryHelper(body)`** -> `DbQueryHelper` -- composable read-only helper. Can only be called inside an `UnreplayableQuery.db(...)`, `UnreplayableSingleMutation.db(...)`, or `SingleMutation.db(...)` body.
- **`createDbMutationHelper(body)`** -> `DbMutationHelper` -- composable mutation helper. Can only be called inside a `SingleMutation.db(...)` or `UnreplayableSingleMutation.db(...)` body.
- `requirePrimaryTransaction(effect)`, `requireTransientTransaction(effect)`, and the family-specific DB transaction scopes are raw transaction-scope tools for infrastructure and adapters. Prefer `*.db(...)` bodies and DB helper constructors for domain code.

## Running At Entry Points

Every RPC handler or entrypoint terminates with an `Operation.run*` call.

### Mutation Handlers

```typescript
pipe(
  SingleMutation.db(
    { success: ResultSchema, error: ErrorSchema },
    Effect.gen(function* () { /* ... */ }),
  ),
  Operation.runReplayable({
    replayKey: ["Namespace.RpcName", replayKey],
  }),
)
```

- `replayKey` comes from the RPC request payload. Namespace it with the RPC name.
- The caller keeps `replayKey` stable across retries of the same logical mutation.

### Unreplayable Mutation Handlers

```typescript
pipe(
  UnreplayableSingleMutation.db(
    Effect.gen(function* () { /* ... */ }),
  ),
  Operation.runUnreplayable,
)
```

- Use when replay is not needed such as maintenance, timing, or coordination internals.

### Read-Only Handlers

```typescript
pipe(
  UnreplayableQuery.effect(
    Effect.gen(function* () { /* ... */ }),
  ),
  Operation.runQuery,
)
```

### Streaming Handlers

```typescript
pipe(
  UnreplayableQueryStream.effect(
    Effect.gen(function* () { /* ... returns Stream ... */ }),
  ),
  Operation.runQuery,
)
```

### Durable Operation Handlers

```typescript
pipe(
  myDurableOperation,
  DurableOperation.execute({ payload }),
  Operation.runReplayable({ replayKey: ["Namespace.RpcName", replayKey] }),
)
```

## Composing With `Flow.call(...)`

Inside a domain operation flow, use `Flow.call(...)` to invoke inner operations. Never call `.run*()` inside an operation flow.

```typescript
SingleMutation.gen(function* () {
  const data = yield* Flow.call(someQuery);
  return yield* Flow.call(someMutation(data));
})
```

Public authoring can use `Flow.gen(...)`, `Flow.call(...)`, and the other `Flow` combinators such as `flatMap`, `tap`, `if`, `matchTag`, and `forEach`. `FlowUnsafe` is reserved for raw `Effect` interop such as `FlowUnsafe.unsafeFromEffect(...)`. Use `Flow.toEffect()` only at plain `Effect` or `Stream` interop boundaries. Otherwise keep composing in `Flow`, and use `Operation.run*` only at entrypoints.

The current context determines what may be called:

- Query flows have `OperationScope` only, so `Flow.call(...)` on a mutation is a compile error.
- Mutation flows have `MutationOperationContext`, so they can call queries and mutations.
- Durable flows add `DurableScope`, enabling `Flow.call(...)` on `ReplayableMultiMutation`s.

Each `Flow.call(...)` gets a structural step key. Auto-generated step keys and structured combinators such as `Flow.forEach(...)` together form the replay path for memoization.

Coordination runtime and framework code that is implementing the operation framework itself should use the internal runtime compose builders in `src/framework/coordination/internal/operations/runtime-compose.ts` rather than the public domain operation constructors in `src/framework/coordination/operations.ts`.

### Explicit Step Keys

Public `Flow.forEach(...)` owns iteration replay identity. Each array element gets its own deterministic child scope, so concurrent loop bodies can safely use plain `Flow.call(...)` inside the iteration body without manual keys.

Explicit step keys are internal-only. Coordination kernel code uses helpers such as `withExplicitChildOperationScope(...)` and `callWithStepKey(...)` when it needs named child scopes outside the public `Flow` combinators.

Duplicate explicit step keys within the same scope are a defect.

## Replay Identity And Memoization

### Replay Path

In replayable mutation contexts, each `Flow.call(...)` gets a stable structural address. On retry, the same path must produce the same observable result.

Replayable mutation roots are also serialized by replay key, so duplicate `Operation.runReplayable({ replayKey })(mutation)` executions cannot overlap and race the same logical path.

### What Gets Memoized

- `Flow.call(Query.effect(...))` or `Flow.call(Query.db(...))` in a replayable mutation context: the result is memoized so the same query returns the same answer on retry.
- `Flow.call(singleMutation)` in a replayable mutation context: the mutation's result is memoized so replay reaches the same observable result without re-executing the mutation.
- `Flow.call(UnreplayableQuery.effect(...))`: never memoized. It cannot be called directly from replayable mutation or durable contexts. Upgrade it to a `ReplayableQuery` with `Query.from(...)`, `Query.effect(...)`, or `Query.db(...)` instead.

### Stable IDs

`replayableTokenQuery()` returns a `ReplayableQuery<string>` that generates a random token, memoized on replay. Use this for any ID that must be stable across retries.

## Durable Operations

Use durable operations for workflows that span multiple independent side effects such as separate transactions or DB plus external API sequences.

### Defining

```typescript
const myOperation = createDurableOperation(
  { key: "Domain.OperationName", domain: MyDurableDomain, payload: PayloadSchema },
  (payload) => Flow.gen(function* () {
    yield* Flow.call(stepOne(payload));
    yield* Flow.call(stepTwo(payload));
  }),
);
```

The default durable-operation authoring story is flow-first: define the body as an `OperationFlow`, and let `createDurableOperation(...)` own the durable execution shell. If you already have a reusable `ReplayableMultiMutation`, adapt it inside the durable implementation with `Flow.call(existingWorkflow(...))` rather than making the durable operation itself multi-mutation-first.

### Running

Three execution modes on the returned handle:

- `DurableOperation.execute(payload)(handle)` -> `ReplayableSingleMutation` -- foreground execution that returns the result with crash recovery.
- `DurableOperation.submit(payload)(handle)` -> `ReplayableSingleMutation<void>` -- fire-and-forget execution that returns once the work is durably enqueued.
- `Flow.call(handle, payload)` -> inline execution within a parent durable operation flow with no independent recovery boundary.

### Nesting

- `DurableOperation.execute(payload)(handle)` cannot be called inside a durable operation.
- `DurableOperation.submit(payload)(handle)` and `Flow.call(handle, payload)` both work within durable contexts for composing follow-up work.

## Choosing A Constructor

- One DB transaction owns the mutation -> `SingleMutation.db(...)`.
- One DB transaction establishes the invariant, and later work merely needs to happen eventually -> keep the DB step as `SingleMutation.db(...)`, then enqueue durable follow-up work.
- Read-only -> `UnreplayableQuery.db(...)`, `UnreplayableQuery.effect(...)`, `Query.db(...)`, or `Query.effect(...)`.
- One external transition where exact replay of the same call is already correct -> `SingleMutation.idempotentExternal(...)`.
- One external transition where duplicate execution is explicitly acceptable -> `UnreplayableSingleMutation.external(...)` or `UnreplayableSingleMutation.effect(...)` plus `unsafeMayDuplicateExecutionMemoizedMutation(...)`.
- One ambiguous external or single-transition interop mutation -> `UnreplayableSingleMutation.external(...)` or `UnreplayableSingleMutation.effect(...)` plus `uncertainMutation(...)`, then either `stabilizeMutation(...)` or explicit domain recovery from `Confirmed` versus `Unknown`.
- One opaque callback or interop execution that may do multiple managed mutation calls -> `uncertainExecution(...)`, then inspect `Completed` versus `UnknownOnCrash`.
- Single-step mutation needing serialization -> add `linearizeSingleMutation(...)`.
- Multi-step durable workflow needing serialization -> build `MultiMutation.gen(...)` or `.compose(...)`, then add `linearizeMultiMutation(...)`.
- Multiple independent side effects -> `MultiMutation.gen(...)` or `.compose(...)` plus `createDurableOperation(...)`.
- Cross-service RPC -> `SingleMutation.rpc(...)`.
- Non-replayable mutation such as maintenance, coordination internals, or raw interop at the edge -> `UnreplayableSingleMutation.db(...)`, `UnreplayableSingleMutation.effect(...)`, or `UnreplayableSingleMutation.external(...)`.

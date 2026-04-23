# Concurrency

## Scope

This document covers when and how to handle concurrent execution. It does not cover transaction isolation or retry semantics; see [database.md](database.md) and [retries.md](retries.md). For the managed operation model, see [operation-types.md](operation-types.md). For mutation ordering across systems, see [mutation-ordering.md](mutation-ordering.md).

## Linearization

- All backend code may execute concurrently on different servers.
- An operation is **linearized** when concurrent execution produces results equivalent to some valid serial ordering.
- If concurrent execution or crash-and-replay cannot be explained by such an ordering, that is a bug.
- Every mutation must choose an explicit linearization strategy.

## One-Transaction DB Work

- DB-only reads and writes that fit in one SERIALIZABLE transaction should use `Query.db(...)`, `UnreplayableQuery.db(...)`, `SingleMutation.db(...)`, or `UnreplayableSingleMutation.db(...)` as appropriate.
- For one-transaction DB mutations, SERIALIZABLE isolation is the linearization mechanism.
- Prefer the smallest transaction that establishes the database invariant. Do not widen a transaction just to make some later step "come along for the ride."
- Do not add extra coordination around a one-transaction DB mutation unless the operation also needs to linearize some non-DB side effect.

## External And Multi-Step Work

- DB transactions do not protect external API calls, separate transactions, or other independently committed side effects.
- Without coordination, two concurrent callers can both observe "not yet done" and both apply the same side effect. That is a bug.
- When the operation is check-then-act without locking, use `toctouQuery(...)` or `toctouMutation(...)`.
- When one single-step mutation needs fresh-caller serialization on a shared resource, use `linearizeSingleMutation(...)`.
- When one durable multi-step workflow needs serialization on a shared resource, use `linearizeMultiMutation(...)`.
- If the only issue is "step X committed, and step Y must still happen later", that is a durable workflow boundary, not a reason to stretch step X's DB transaction.
- When the workflow spans multiple independent side effects, model it as `MultiMutation` plus `createDurableOperation(...)` rather than open-coded retries or ad hoc locking.

## Low-Level Coordination

- Prefer higher-level operation primitives over direct use of leases, queues, memos, or other low-level transient coordination mechanics.
- Use low-level coordination services directly only in coordination infrastructure or when no higher-level primitive fits the correctness boundary.
- See [modules/coordination.md](modules/coordination.md) for the coordination module surface and storage backends.

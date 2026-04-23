# Mutation Ordering

## Scope

This document covers how to order mutations when an operation spans multiple systems or module boundaries.

## Cross-System Ordering

- When a multi-step operation mutates state across multiple systems, order mutations as the reverse of the observation order.
- Setup (resource creation): write the external system first, then the local DB. The resource becomes observable only once fully provisioned.
- Teardown (resource deletion): write the local DB first, then the external system. The resource becomes unobservable immediately.
- A "system" is an ownership or observation boundary, not necessarily a separate process or database.
- If module A interacts with module B only through B's interface, A may treat calls into B as a separate side effect for ordering purposes.

## Recursive Boundaries

- Apply mutation ordering recursively at each boundary.
- The caller orders its own state relative to calls into the child module.
- The child module orders its own local state relative to the external systems it wraps.
- Do not reach across module boundaries to mutate another module's internal tables to force ordering.
- Do not widen a caller-owned DB transaction across module boundaries.
- Do not widen a DB transaction merely to guarantee that a later step eventually happens. Commit the local step at its natural DB boundary, then model the later step explicitly as durable follow-up work.
- When a workflow spans boundaries, compose the sequence as a durable operation (`createDurableOperation(...)` plus `MultiMutation`) with explicit replayable steps. Ordering comes from the managed operation structure, not from piercing abstraction boundaries.

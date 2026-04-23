# Layers

## Scope

This document covers layer kinds and the rules specific to each kind.

## Layer Kinds

- Service layers implement runtime services.
- Contribution layers register concern-specific work when built.
- Aggregation layers merge lower-level layers for one concern.
- Process layers assemble the runtime for an entrypoint or long-lived worker.

## Service Layers

- `ServiceMap.Service` classes should expose their layer as `static readonly layer`.
- Service layers should be self-wired and expose `never` in their error channel.
- Use `selfLayer(...)` when the constructor already has no service-private dependencies.
- Use `selfLayerWith(...)` when the service layer closes its service-private dependencies with other self-wired layers.
- Service constructors must decide fatal setup errors locally and reclassify them as defects or explicit operator-facing CLI errors before surfacing.
- Service dependencies must be explicit.
- Service-private dependencies belong at the dependent service layer, not at call sites.
- Prefer service layers that are as dependency-free as possible from the outside.
- Do not rely on ambient context for service internals.
- Do not export reusable APIs that return live service values pre-wired with ad hoc `Layer.provide(...)`.
- Use `withSelfService(...)` or a domain-specific adapter helper at process or adapter edges and in explicit handle factories.

## Contribution Layers

- Contribution layers should self-register with the concern when built.
- Contribution layers should own concern-specific registration, not service-private wiring.

## Aggregation Layers

- Cross-module concerns should compose through `Layer.mergeAll`.
- A module that contributes to a cross-module concern should expose a module-level aggregation layer for that concern.
- If `ModuleA` depends on `ModuleB`, `ModuleB`'s contribution must remain in the aggregation chain.
- Modules should import concern aggregation only from direct dependents.
- Concern-shared dependencies belong at the owning aggregation layer when the concern has one.
- Aggregation layers should assemble contributions, not re-own service-private wiring.

## Process Layers

- Process layers should assemble the runtime for an entrypoint or long-lived worker.
- Process layers should build the relevant aggregation layers and then execute the registered work.
- Host-owned dependencies belong at the process layer.
- Environment-backed process wiring should be required and typed at the wiring boundary; missing or invalid values are wiring failures, not optional feature branches.
- Process layers may own concern-shared dependencies when the concern does not have a narrower owner.

## Naming

- Non-service layer values should use the `*Layer` suffix.

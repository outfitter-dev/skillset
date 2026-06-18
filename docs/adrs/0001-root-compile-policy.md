---
id: 1
slug: root-compile-policy
title: Root Compile Policy
status: accepted
created: 2026-06-04
updated: 2026-06-04
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0]
---

# ADR-0001: Root Compile Policy

## Context

Skillset originally let target provider blocks such as `claude` and `codex` sit at the top level of configuration. That worked for target-native options, but it made provider selection awkward. A source repo that wanted to compile both providers had to repeat boolean-ish target settings, and new source surfaces could look like silent failures if they were added without revisiting every target block.

Provider selection is not a Claude or Codex semantic feature. It is a compile concern: which outputs should Skillset build from the source graph. Unsupported destination behavior is also a compile concern: what happens when authored source cannot render faithfully to an enabled provider.

## Decision

Root provider selection belongs under `compile`.

The root source contract uses:

```yaml
compile:
  targets:
    - claude
    - codex
  unsupportedDestination: error
```

This means:

- `compile.targets` chooses which provider projections to build.
- Omitting `compile.targets` defaults to every supported provider.
- Bare top-level `targets:` is rejected so provider selection has one canonical home.
- `claude` and `codex` blocks remain target-specific options, output settings, target-native escape hatches, and lower-level opt-outs.
- `compile.unsupportedDestination` defaults to `error`.
- `warn`, `skip`, and `force` are reserved until warnings, doctor output, and lock provenance can record exactly what happened.

The test: if a setting decides whether Skillset builds a provider projection, it belongs under `compile`. If it configures the shape of a provider-native output, it belongs under that provider's block or a lower-level target override.

## Consequences

### Positive

The common case gets smaller. Authors can say "compile these providers" once, then let source presence drive skills, plugins, instructions, hooks, and future surfaces.

New source surfaces are less likely to disappear silently. If a provider is enabled and Skillset cannot render authored source faithfully, the default policy fails before generated output can look synchronized.

Target-specific configuration stays honest. `claude` and `codex` remain the visible places for target-native differences instead of becoming a mix of provider selection and target semantics.

### Tradeoffs

The resolver now has to distinguish provider selection from target-native configuration. That adds a small amount of schema and validation responsibility, but it keeps the source contract sharper.

Soft unsupported policies are intentionally delayed. Migration users may eventually need `warn`, `skip`, or `force`, but enabling them before provenance exists would recreate the silent-drift problem this ADR is trying to prevent.

### What This Does NOT Decide

This ADR does not enable `warn`, `skip`, or `force`. It reserves those modes and requires provenance before implementation.

This ADR does not define a portable source model for agents, hook activation, installs, or registry sync. Those surfaces need separate target evidence and separate decisions.

## References

- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - baseline source-first compiler doctrine.
- [Tenets](../tenets.md) - governing design principles for source-first loadouts and target-native rendering.

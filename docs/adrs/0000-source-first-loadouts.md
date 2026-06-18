---
id: 0
slug: source-first-loadouts
title: Source-First Loadouts
status: accepted
created: 2026-06-04
updated: 2026-06-04
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0000: Source-First Loadouts

## Context

Skillset exists because authoring parallel Claude and Codex loadouts by hand creates avoidable drift. The same skill, instruction, hook definition, or plugin intent can end up repeated across target-specific trees, and small differences become hard to audit once generated output is treated as source truth.

The repo already carries this doctrine in [Tenets](../tenets.md), but agents need a numbered decision trail for changes that affect source vocabulary, target lowering, generated-output promises, and future schema migrations. A baseline ADR gives future records a stable decision to extend, specialize, or supersede.

## Decision

Skillset is a source-first compiler for agent loadouts.

This means:

- `.skillset/` is the authored source of truth.
- Claude and Codex outputs are deterministic, target-native projections of that source.
- Build, check, lint, diff, doctor, explain, and import are authoring tools; they do not install, trust, publish, or activate generated artifacts.
- Portable source keys exist only when Skillset can lower the author intent faithfully.
- Target-specific truth stays visible through `claude` and `codex` blocks, lower-level opt-outs, diagnostics, lock provenance, or explicit target-native escape hatches.

The test for new source vocabulary is simple: it should reduce repeated authoring, make drift easier to see, and preserve target-native behavior. If a key only makes two different target features look the same, it does not belong in the portable contract.

## Consequences

### Positive

Future ADRs can build on one baseline decision instead of re-arguing why `.skillset/` is source truth or why generated output remains disposable.

Compiler changes have a clearer review frame: they either strengthen source-first authoring and faithful lowering, or they must explain why the doctrine should change.

### Tradeoffs

Skillset accepts extra compiler responsibility. Derivation, validation, locking, and diagnostics need to be good enough that authors can trust generated output without editing it by hand.

The compiler also has to say no. A provider feature that cannot lower faithfully may require a target-specific escape hatch, an explicit opt-out, or a failing diagnostic instead of a convenient but false abstraction.

### What This Does NOT Decide

This ADR does not decide every portable key in the source schema.

It does not decide how future agent, hook, resource, MCP, app, or install workflows should lower. Those decisions need their own ADRs when the target evidence and implementation plan are concrete.

## References

- [Tenets](../tenets.md) - governing design principles for source-first loadouts and target-native rendering.
- [ADR-0001: Root Compile Policy](0001-root-compile-policy.md) - accepted `compile.targets` and `compile.unsupportedDestination` direction.

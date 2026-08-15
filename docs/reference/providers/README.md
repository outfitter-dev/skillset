---
description: Explains Skillset's provider vocabulary and routes to canonical targets and generated support facts.
---

# Provider Reference

A Skillset [target](../../glossary.md#target) is an enabled provider adapter selected for a compiler run. It receives [provider-native](../../glossary.md#provider-native) output produced by a [render](../../glossary.md#render), which a [build](../../glossary.md#build) can write. A runtime is a concrete application or harness that may consume that output. Adding a runtime does not add a target, and rendering provider output does not prove [activation](../../glossary.md#activation).

Use the [feature support matrix](../support-matrix.md) for the exhaustive registry-owned view of feature status across every canonical target. The authored provider pages explain how to interpret those facts: native output shapes, important unsupported or provider-native boundaries, and the evidence behind current claims. Status terms are defined once in the [feature-reference support vocabulary](../features/README.md#support-vocabulary).

## Providers

<!-- skillset:generated:start provider-list -->
- [Claude](./claude.md) — Skillset support and provider-specific guidance for the `claude` target.
- [Codex](./codex.md) — Skillset support and provider-specific guidance for the `codex` target.
- [Cursor](./cursor.md) — Skillset support and provider-specific guidance for the `cursor` target.
<!-- skillset:generated:end provider-list -->

## Reading Provider Support

A support cell describes what Skillset can render for one feature and target. It does not prove that a runtime installed, trusted, discovered, or invoked the result. Open the linked feature page for authoring shape, diagnostics, qualifications, and evidence; open the provider page for target-level constraints that cut across features.

Provider evidence is checked into the repository so ordinary builds stay deterministic and offline. Maintainers refresh that evidence through the [feature-registry provider evidence procedure](../../development/features/feature-registry.md#provider-evidence-refresh).

The [hosted provider-validation record](../provider-validation.md) lists exact external pins, the surfaces each validator actually covers, negative canaries, and the internal-conformance fallback for uncovered provider behavior.

Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](../../start/build-versus-activation.md).

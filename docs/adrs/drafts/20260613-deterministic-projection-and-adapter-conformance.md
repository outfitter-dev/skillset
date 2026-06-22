---
slug: deterministic-projection-and-adapter-conformance
title: Deterministic Projection and Adapter Conformance
status: draft
created: 2026-06-13
updated: 2026-06-13
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, core-library-boundary, feature-reference-and-schema-registry, fixtures-tests-dogfooding-and-evals]
---

# ADR: Deterministic Projection and Adapter Conformance

## Context

Skillset has crossed the line where "the tests pass" is not enough evidence for the compiler contract. The compiler now lowers portable source into multiple target-native trees, writes lock provenance, reports structured operation diagnostics, tracks feature support, and exposes core library results for non-CLI consumers. A hidden absolute path, unstable object ordering, host-specific separator, or target adapter skip can make generated output look clean in one checkout and drift in another.

The earlier fixtures/tests/evals decision separated internal compiler fixtures, dogfooding, deterministic tests, and future model-facing evals. The core library boundary then established that `@skillset/core` should return compiler facts and plans while `apps/skillset` renders those facts for humans. The next step is a concrete verification lane for deterministic projection and adapter conformance that can be reused by internal fixtures, external adoption fixtures, and future core consumers.

The pressure is practical: Skillset needs to dogfood itself before a Trails integration, and later Trails may call Skillset as a library. The deterministic proof must therefore be available without installing generated Claude/Codex artifacts, mutating global runtime config, calling providers, or relying on a human reading CLI output.

## Decision

Skillset adds a compiler-verification lane for deterministic projections and adapter conformance. This lane compares what the compiler emits and reports from the same source under clean roots. It is not a Claude or Codex behavioral eval.

The keeper sentence is: deterministic projection proves the compiler emits the same target artifacts and evidence from the same source; adapter conformance proves each target lowering outcome matches the feature registry's declared support.

### Projection Comparison

The deterministic runner builds equivalent source in clean temp roots and compares the projection after explicit normalization. The comparison scope is:

| Surface | Compared As | Rule |
| --- | --- | --- |
| Generated target files | bytes | Skill, plugin, instruction, manifest, hook, app, MCP, resource, and island output should be byte-stable. |
| `skillset.lock` files | canonical JSON | Object key ordering may be normalized for comparison, but data content must match. |
| Core operation results | canonical JSON | `diagnostics`, `loweringOutcomes`, `writes`, and checked-file counts should be stable after approved path normalization. |
| Reports owned by Skillset | canonical text or JSON | Reports may normalize temp-root prefixes only when they are documented as run locations. |
| Runtime/provider state | not compared | Installing, trusting, publishing, or activating output is outside this lane. |

The allowed normalizations are narrow:

- Convert path separators to POSIX-style `/`.
- Strip only the test runner's own temp-root prefix from paths that are explicitly documented as temp-root paths.
- Canonicalize JSON object key order for generated lock/report/result comparisons.
- Exclude documented volatile paths under the runner's own output directory when the path is a retained run index rather than compiler output.

Everything else should fail. Absolute source temp paths in hash material, timestamps in generated locks, nondeterministic object serialization, locale-dependent sorting, host-specific separators in generated files, or different target output bytes are compiler bugs until proven otherwise.

### Adapter Conformance

Adapter conformance is structural. It checks that source units lower to the statuses and support evidence declared by the feature registry. For example, a feature declared `native` should not produce a `lossy` outcome without a reason, a target-native pass-through should not masquerade as portable transformation, and an unsupported target decision should surface as a structured outcome or a lowering error rather than disappearing.

This means conformance tests consume `loweringOutcomes` and the feature registry together. They do not ask whether Claude or Codex behaves well after runtime activation. They ask whether Skillset told the truth about what it emitted, transformed, skipped, degraded, or rejected.

### Fast and Slow Lanes

The default fast lane runs on small local fixture/source selections and should be suitable for `bun run check` once it is proven cheap and stable. It may use the kitchen-sink fixture and selected self-hosted source cases.

The slower lane covers external adoption fixtures, large fixture corpora, and future provider-specific conformance packs. It can be wired to explicit scripts or CI jobs after the fast lane is stable. Slow lanes may be skipped by default, but they should still use the same comparison utilities so failures look the same.

`skillset:ci` remains the product-facing generated-output gate. The deterministic projection lane complements it by proving that clean-root compilation is reproducible and that structured outcomes are stable. `skillset test` remains the user-facing deterministic test runner for declared scenarios. Internal fixture determinism can use the same utilities without turning fixtures into a public test schema.

### Eval Boundary

Evals remain future and adapter-aware. They may involve prompts, graders, model calls, token measurement, provider credentials, target-native eval formats, and human review. Those concerns are intentionally outside deterministic projection. A deterministic test can prove that an eval file was generated or copied correctly; it cannot prove that a model performs the task well.

## Consequences

### Positive

Future agents get a clear implementation test: build the same source twice in clean roots and compare generated trees, lockfiles, reports, and structured outcomes. This should catch absolute path leaks, ordering drift, host-specific serialization, and unproven target lowering earlier than manual review.

The comparison model also gives the feature registry a concrete job. Registry rows are not just docs; they become the expected support envelope for lowering outcomes and conformance fixtures.

### Tradeoffs

The runner needs normalized tree utilities before it can be trustworthy. A naive byte diff of whole temp directories would produce noisy failures from run metadata, while too much normalization would hide real bugs. The comparison layer must be small, explicit, and test-covered before it becomes a default gate.

Adding structured outcome comparison also means result schemas become part of the compiler contract. That is good, but it raises the review bar for changing outcome field names, statuses, and target evidence.

### Non-Decisions

This ADR does not define a public `.skillset/tests/` schema, implement eval execution, install marketplaces into Claude/Codex, decide CI timing for slow external fixtures, or require Trails adoption. It also does not decide the final conformance fixture taxonomy; it only defines the boundary those fixtures must respect.

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - governing source and generated-output doctrine.
- [Core Library and CLI Boundary](20260612-core-library-boundary.md) - places structured compiler facts in `@skillset/core`.
- [Feature Reference and Schema Registry](20260604-feature-reference-and-schema-registry.md) - registry-backed support and evidence model used by adapter conformance.
- [Fixtures, Tests, Dogfooding, and Evals](20260609-fixtures-tests-dogfooding-and-evals.md) - separates fixtures, dogfooding, deterministic tests, and evals.
- [Tests and Evals](../../features/tests-and-evals.md) - feature-facing documentation for current and future verification surfaces.
- SET-45, SET-49, and SET-50 - earlier product decisions for fixture boundaries, deterministic test selection, and the first `skillset test` slice.

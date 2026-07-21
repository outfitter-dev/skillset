---
id: 19
slug: deterministic-projection-and-adapter-conformance
title: Deterministic Projection and Adapter Conformance
status: accepted
created: 2026-06-13
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 4, 5, 12, 18]
---

# ADR-0019: Deterministic Projection and Adapter Conformance

## Context

Skillset has crossed the line where "the tests pass" is not enough evidence for the compiler contract. The compiler renders portable source into multiple target-native trees, writes lock provenance, reports structured operation diagnostics and Render Results, tracks feature support, and exposes core library results for non-CLI consumers. A hidden absolute path, unstable object ordering, host-specific separator, or target adapter skip can make generated output look clean in one checkout and drift in another.

The earlier fixtures/tests/evals decision separated internal compiler fixtures, dogfooding, deterministic tests, and future model-facing evals. The core library boundary established that `@skillset/core` returns compiler facts and plans while `apps/skillset` renders those facts for humans. Deterministic projection and adapter conformance provide the reusable verification lane for internal fixtures, external adoption fixtures, and core consumers.

The deterministic proof is available without installing generated provider artifacts, mutating global runtime config, calling providers, or relying on a human reading CLI output.

## Decision

Skillset provides compiler-verification lanes for deterministic projections and adapter conformance. They compare what the compiler emits and reports from the same source under clean roots. They are not provider behavioral evals.

The keeper sentence is: deterministic projection proves the compiler emits the same target artifacts and evidence from the same source; adapter conformance proves each target Render Result matches the feature registry's declared support.

### Projection Comparison

The deterministic runner builds equivalent source in clean temp roots and compares the projection after explicit normalization. The comparison scope is:

| Surface | Compared As | Rule |
| --- | --- | --- |
| Generated target files | bytes | Skill, plugin, instruction, manifest, hook, app, MCP, resource, and island output should be byte-stable. |
| `skillset.lock` files | canonical JSON | Object key ordering may be normalized for comparison, but data content must match. |
| Core operation results | canonical JSON | `diagnostics`, `renderResults`, `writes`, and checked-file counts should be stable after approved path normalization. |
| Reports owned by Skillset | canonical text or JSON | Reports may normalize temp-root prefixes only when they are documented as run locations. |
| Runtime/provider state | not compared | Installing, trusting, publishing, or activating output is outside this lane. |

The allowed normalizations are narrow:

- Convert path separators to POSIX-style `/`.
- Strip only the test runner's own temp-root prefix from paths that are explicitly documented as temp-root paths.
- Canonicalize JSON object key order for generated lock/report/result comparisons.
- Exclude documented volatile paths under the runner's own output directory when the path is a retained run index rather than compiler output.

Everything else should fail. Absolute source temp paths in hash material, timestamps in generated locks, nondeterministic object serialization, locale-dependent sorting, host-specific separators in generated files, or different target output bytes are compiler bugs until proven otherwise.

### Adapter Conformance

Adapter conformance is structural. It checks that source units render to the statuses and support evidence declared by the feature registry. For example, a feature declared `native` should not produce a `lossy` result without a reason, a target-native pass-through should not masquerade as portable transformation, and an unsupported target decision should surface as a structured result or a render error rather than disappearing.

This means conformance tests consume `renderResults` and the feature registry together. They do not ask whether Claude, Codex, or Cursor behaves well after runtime activation. They ask whether Skillset told the truth about what it rendered, transformed, skipped, degraded, or rejected.

### Fast and Slow Lanes

`bun run conformance:fast` composes deterministic projection and representative adapter/provider-format checks and runs through `bun run test` in the default aggregate gate.

`bun run conformance:external` covers pinned external adoption fixtures and remains opt-in because it fetches/resets fixture clones and writes XDG-backed reports. It uses the same comparison utilities while staying outside default checks and PR CI.

`skillset:check:ci` remains the product-facing generated-output gate. Deterministic projection complements it by proving clean-root compilation reproducible and Render Results stable. `skillset test` remains the user-facing deterministic test runner for declared scenarios.

### Eval Boundary

Evals remain future and adapter-aware. They may involve prompts, graders, model calls, token measurement, provider credentials, target-native eval formats, and human review. Those concerns are intentionally outside deterministic projection. A deterministic test can prove that an eval file was generated or copied correctly; it cannot prove that a model performs the task well.

## Consequences

### Positive

Agents have a clear verification test: build the same source twice in clean roots and compare generated trees, lockfiles, reports, and Render Results. This catches absolute path leaks, ordering drift, host-specific serialization, and unproven target rendering earlier than manual review.

The comparison model gives the feature registry a concrete job. Registry rows are not just docs; they are the expected support envelope for Render Results and conformance fixtures.

### Tradeoffs

The runner relies on small, explicit, test-covered normalization. A naive byte diff of whole temp directories would produce noisy failures from run metadata, while too much normalization would hide real bugs.

Structured Render Result comparison makes result schemas part of the compiler contract and raises the review bar for changing field names, statuses, and target evidence.

### Non-Decisions

This ADR does not redefine the accepted `.skillset/tests*` declaration schema,
implement eval execution, install marketplaces into provider runtimes, require
the external lane in default CI, or require Trails adoption. It also does not
decide a final conformance fixture taxonomy.

## Acceptance Evidence (2026-07-20)

Deterministic projection compares generated
trees, locks, structured operation facts, and Render Results from equivalent
clean roots. Adapter conformance compares representative registry support rows
with produced Render Results or render errors across Claude, Codex, and Cursor,
and provider-format checks validate adopted destination snapshots.

`bun run conformance:determinism` runs the clean-root lane;
`bun run conformance:adapters` runs representative registry/result and format
checks; `bun run conformance:fast` composes both and is already included through
`bun run test` in `bun run check` and PR CI. The opt-in
`bun run conformance:external` lane uses pinned adoption fixtures and writes
XDG-backed reports under logical `.skillset/cache/fixtures/<name>/` paths; it
stays outside default check, `skillset:check:ci`, and PR CI. Coverage gaps are
reported explicitly. These lanes provide bounded compiler/adoption evidence,
not exhaustive provider runtime or external-repository validation. Evals remain
future and adapter-aware.

## References

- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - governing source and generated-output doctrine.
- [Core Library and CLI Boundary](0004-core-library-boundary.md) - places structured compiler facts in `@skillset/core`.
- [Feature Reference and Schema Registry](0005-feature-reference-and-schema-registry.md) - registry-backed support and evidence model used by adapter conformance.
- [Fixtures, Tests, Dogfooding, and Evals](0012-fixtures-tests-dogfooding-and-evals.md) - separates fixtures, dogfooding, deterministic tests, and evals.
- [Tests and Evals](../features/tests-and-evals.md) - feature-facing documentation for current and future verification surfaces.
- SET-45, SET-49, and SET-50 - earlier product decisions for fixture boundaries, deterministic test selection, and the first `skillset test` slice.

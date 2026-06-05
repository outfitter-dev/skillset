# Feature Reference

The feature reference is the human-readable support registry for Skillset v1. It explains how authored source maps to Claude and Codex target surfaces, which features are portable, which are target-native, and where support is deferred or future-only. This directory is manual for now; future schema-backed generation is deliberately deferred until the page shape proves itself.

Use these pages alongside the [target surface evidence matrix](../target-surfaces.md). The matrix is the compact target-fact table; feature pages explain authoring shape, target lowering, diagnostics, provenance, examples, and test coverage.

## Initial Pages

- [Agents](agents.md): portable project agents, Claude plugin agents, Codex project agents, and skill-local Codex policy boundaries.
- [Target-Native Islands](target-native-islands.md): explicit Claude/Codex source islands, Codex `.rules` pass-through, and leakage rules.
- [Build Scopes](build-scopes.md): build mode, destination scopes, dry-run safety, diff/list/explain behavior, and lock semantics.
- [Feature Source Pointers](feature-source-pointers.md): direct feature-key source pointers, conventional discovery, and future component ownership.

## Support Vocabulary

| Status | Meaning |
| --- | --- |
| `implemented` | Parsed, validated, rendered, tested, and documented in the current compiler. |
| `compat_alias` | Accepted legacy or native spelling that normalizes to the canonical source form. |
| `portable` | Authored once because enabled targets can represent the same intent faithfully. |
| `target_native` | Supported only through one target's native source or adapter path. |
| `metadata_only` | Captured in generated metadata or lock provenance, but not target-enforced. |
| `planned` | Accepted design with no parser/render support yet. |
| `reserved` | Recognized vocabulary that fails until behavior and provenance exist. |
| `deferred` | Intentionally not emitted; documented reason. |
| `unsupported` | Cannot lower to an enabled target without explicit target scoping or unsupported policy. |
| `lossy` | A possible lowering would drop target meaning or behavior; fail unless a future ADR defines visible provenance. |
| `future` | Outside the v1 runtime contract but tracked as a possible later design. |

Unsupported and lossy lowering must fail loudly by default. Softer outcomes such as warn, skip, or force require visible diagnostics and lock or doctor provenance before they can become runtime behavior.

## Registry Shape

Each feature page uses the same registry-oriented fields, even though the registry is not implemented as code yet:

| Field | Purpose |
| --- | --- |
| Feature id | Stable id for docs, diagnostics, and future registry entries. |
| Source shape | Source paths, config keys, frontmatter keys, aliases, defaults, and conventional discovery. |
| Target support | Per-target support status, output paths, target-native escape hatches, and unsupported cases. |
| Lowering owner | Whether behavior belongs to the portable resolver, the Claude adapter, the Codex adapter, or a target-native pass-through. |
| Validation | Lint/build/check diagnostics and structured output validation ownership. |
| Provenance | Lock entries, hashes, warnings, skipped output, target state, and explain/doctor surfaces. |
| Evidence | Provider docs, ADRs, Linear issues, tests, and fixtures that justify the current status. |

Future schema generation can turn these fields into typed data, but SET-28 does not introduce a generator, runtime registry, or new compiler behavior.

## Future-Only Features

These are tracked as future/reserved unless a later issue promotes them:

- [Reviewed settings suggestion workflow](../adrs/drafts/20260604-reviewed-settings-suggestions.md): Skillset may eventually propose or review target settings changes, but `skillset build` must not mutate user-level Claude or Codex config.
- Model and reasoning alias profiles: shared aliases such as `review`, `fast`, or `deep` remain deferred; use target-native model and effort fields where supported.
- First-class sets: grouped marketplaces, bundles, and curated collections remain future vocabulary; v1 keeps build scopes and entity selectors separate.
- Generated feature docs: docs remain manual until the feature reference shape is stable enough to generate from typed registry data.

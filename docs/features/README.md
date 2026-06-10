# Feature Reference

The feature reference is the human-readable support registry for Skillset v1. It explains how authored source maps to Claude and Codex target surfaces, which features are portable, which are target-native, and where support is deferred or future-only. This directory is manual for now; future schema-backed generation is deliberately deferred until the page shape proves itself.

Use these pages alongside the [target surface evidence matrix](../target-surfaces.md). The matrix is the compact target-fact table; feature pages explain authoring shape, target lowering, diagnostics, provenance, examples, and test coverage.

## Initial Pages

- [Agents](agents.md): portable project agents, Claude plugin agents, Codex project agents, and skill-local Codex policy boundaries.
- [Apps](apps.md): Codex plugin `.app.json` pass-through and why there is no v1 `apps.source` feature key.
- [Build Scopes](build-scopes.md): build mode, destination scopes, dry-run safety, diff/list/explain behavior, and lock semantics.
- [Changes](changes.md): pending change entries, source coverage, compact refs, groups, and append-only history boundaries.
- [CI](ci.md): the `skillset ci` aggregate check, mechanical drift rebuilds, PR-comment reports, and the `--with-ci` workflow scaffold.
- [Commands](commands.md): Claude plugin command pass-through, manifest wiring, and Codex unsupported boundaries.
- [Dependencies](dependencies.md): plugin dependency declarations, Claude lowering, Codex fallback notices, and provenance.
- [Executables](executables.md): Claude plugin `bin/` conventional discovery, `bin.source`, and Codex unsupported diagnostics.
- [Feature Source Pointers](feature-source-pointers.md): direct feature-key source pointers, conventional discovery, and future component ownership.
- [Hook Guardrails](hook-guardrails.md): Git hook-runner snippets and optional agent-runtime nudges for change/release checks.
- [Hooks](hooks.md): hook definition emission, canonical source paths, target validation, and activation boundaries.
- [Instructions](instructions.md): `.skillset/instructions` lowering to Claude rules and Codex `AGENTS.md`, preprocessing, and collision safety.
- [LSP Servers](lsp-servers.md): Claude plugin `.lsp.json` pass-through, manifest wiring, and future validation boundaries.
- [MCP Servers](mcp-servers.md): plugin `.mcp.json`, `mcp.source`, manifest wiring, and structured validation.
- [Monitors](monitors.md): Claude experimental monitor pass-through, manifest wiring, and Codex unsupported boundaries.
- [Output Styles](output-styles.md): Claude output style directory pass-through and manifest wiring.
- [Plugins](plugins.md): plugin source identity, manifest projection, companion paths, and plugin boundaries.
- [Releases And Changelogs](releases.md): release state, generated changelog projections, version planning, and package-tool interop.
- [Resources](resources.md): shared resource declarations, link rewriting, executable-script linting, and lock hashing.
- [Settings](settings.md): future reviewed settings suggestion workflow and why build does not mutate runtime config.
- [Skills](skills.md): standalone and plugin-bound skill frontmatter, target lowering, versions, metadata, and generated sidecars.
- [Supports](supports.md): compatibility metadata, support ranges, source significance, and release severity boundaries.
- [Target-Native Islands](target-native-islands.md): explicit Claude/Codex source islands, Codex `.rules` pass-through, and leakage rules.
- [Tests and Evals](tests-and-evals.md): internal fixtures, dogfooding, deterministic `skillset test`, future adapter-aware evals, and generated run output boundaries.
- [Themes](themes.md): Claude experimental theme pass-through, manifest wiring, and Codex unsupported boundaries.
- [Tool Intent](tool-intent.md): portable tool intent metadata, Claude preapproval lowering, Codex metadata, and target-native escapes.

## Support Vocabulary

| Status | Meaning |
| --- | --- |
| `implemented` | Parsed, validated, rendered, tested, and documented in the current compiler. |
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
| Source shape | Source paths, config keys, frontmatter keys, defaults, and conventional discovery. |
| Target support | Per-target support status, output paths, target-native escape hatches, and unsupported cases. |
| Lowering owner | Whether behavior belongs to the portable resolver, the Claude adapter, the Codex adapter, or a target-native pass-through. |
| Validation | Lint/build/check diagnostics and structured output validation ownership. |
| Provenance | Lock entries, hashes, warnings, skipped output, target state, and explain/doctor surfaces. |
| Evidence | Provider docs, ADRs, Linear issues, tests, and fixtures that justify the current status. |

Future schema generation can turn these fields into typed data, but SET-28 does not introduce a generator, runtime registry, or new compiler behavior.

## Future-Only Features

These are tracked as future/reserved unless a later issue promotes them:

- [Reviewed settings suggestion workflow](../adrs/drafts/20260604-reviewed-settings-suggestions.md): Skillset may eventually propose or review target settings changes, but `skillset build` must not mutate user-level Claude or Codex config.
- [Model and reasoning alias profiles](../adrs/drafts/20260604-model-and-reasoning-alias-profiles.md): shared aliases such as `review`, `fast`, or `deep` remain deferred; use target-native model and effort fields where supported.
- [First-class sets](../adrs/drafts/20260604-first-class-sets.md): grouped marketplaces, bundles, and curated collections remain future vocabulary; v1 keeps build scopes and entity selectors separate.
- [Tests and evals](tests-and-evals.md): adapter-aware eval support and expanded test selectors remain planned/future; deterministic `skillset test` has a first isolated projection slice.
- Generated feature docs: docs remain manual until the feature reference shape is stable enough to generate from typed registry data.

# Feature Reference

The feature reference is the human-readable support registry for Skillset v1. It explains how authored source maps to Claude and Codex target surfaces, which features are portable, which are target-native, and where support is deferred or future-only. This directory is manual for now; future schema-backed generation is deliberately deferred until the page shape proves itself.

Use these pages alongside the [target surface evidence matrix](../target-surfaces.md). The matrix is the compact target-fact table; feature pages explain authoring shape, target rendering, diagnostics, provenance, examples, and test coverage.

## Initial Pages

- [Activation Probes](tests-and-evals.md#activation-probes): target-aware manual harness prompts generated inside `skillset test` runs.
- [Agents](agents.md): portable project agents, Claude plugin agents, Codex project agents, and skill-local Codex policy boundaries.
- [Apps](apps.md): Codex plugin `.app.json` pass-through and why there is no v1 `apps.source` feature key.
- [Build Scopes](build-scopes.md): build mode, destination scopes, dry-run safety, diff/list/explain behavior, and lock semantics.
- [Changes](changes.md): pending change entries, source coverage, compact refs, groups, and append-only history boundaries.
- [CI](ci.md): the `skillset ci` aggregate check, mechanical drift rebuilds, PR-comment reports, and the `--include ci` workflow scaffold.
- [Commands](commands.md): Claude plugin command pass-through, manifest wiring, and Codex unsupported boundaries.
- [Dependencies](dependencies.md): plugin dependency declarations, Claude rendering, Codex fallback notices, and provenance.
- [Distributions](distributions.md): post-build distribution planning, destination reports, and build/distribution/activation boundaries.
- [Executables](executables.md): Claude plugin `bin/` conventional discovery, `bin.source`, and Codex unsupported diagnostics.
- [Feature Source Pointers](feature-source-pointers.md): direct feature-key source pointers, conventional discovery, and future component ownership.
- [Feature Registry](feature-registry.md): typed support matrix for feature ids, target capability claims, docs, evidence, render owners, and validation owners.
- [Hook Guardrails](hook-guardrails.md): Git hook-runner snippets and optional agent-runtime nudges for change/release checks.
- [Hooks](hooks.md): hook definition emission, canonical source paths, target validation, and activation boundaries.
- [Instructions](instructions.md): `.skillset/src/rules` rendering to Claude rules and Codex `AGENTS.md`, preprocessing, and collision safety.
- [LSP Servers](lsp-servers.md): Claude plugin `.lsp.json` pass-through, manifest wiring, and future validation boundaries.
- [MCP Servers](mcp-servers.md): plugin `.mcp.json`, `mcp.source`, manifest wiring, and structured validation.
- [Monitors](monitors.md): Claude experimental monitor pass-through, manifest wiring, and Codex unsupported boundaries.
- [Output Safety](output-safety.md): managed output ownership, unmanaged neighbor handling, reversible backups, and restore.
- [Output Styles](output-styles.md): Claude output style directory pass-through and manifest wiring.
- [Plugins](plugins.md): plugin source identity, manifest rendering, companion paths, and plugin boundaries.
- [Releases And Changelogs](releases.md): release state, generated changelog renderings, version planning, and package-tool interop.
- [Render Results](render-results.md): structured per-build report for rendered, transformed, degraded, skipped, unsupported, and externally managed render facts.
- [Resources](resources.md): shared resource declarations, link rewriting, executable-script linting, and lock hashing.
- [Runtime Adapters](runtime-adapters.md): runtime, distribution, and harness support records that stay separate from `compile.targets`.
- [Settings](settings.md): future reviewed settings suggestion workflow and why build does not mutate runtime config.
- [Skills](skills.md): standalone and plugin-bound skill frontmatter, target rendering, versions, metadata, and generated sidecars.
- [Source Suggestions](source-suggestions.md): future managed-output edit recovery through source-side suggestions, distinct from settings suggestions.
- [Supports](supports.md): compatibility metadata, support ranges, source significance, and release severity boundaries.
- [Provider Source](target-native-islands.md): explicit Claude/Codex provider source, Codex `.rules` pass-through, and leakage rules.
- [Tests and Evals](tests-and-evals.md): internal fixtures, dogfooding, deterministic `skillset test`, future adapter-aware evals, and generated run output boundaries.
- [Themes](themes.md): Claude experimental theme pass-through, manifest wiring, and Codex unsupported boundaries.
- [Tool Intent](tool-intent.md): portable tool intent metadata, Claude preapproval rendering, Codex metadata, and target-native escapes.
- [Version Audit](version-audit.md): read-only version-locus audit across source, release state, generated output, and future destinations.
- [Workbench Check](workbench.md): `skillset check`, `skillset verify`, package-level diagnostic scopes/presets, parser/schema checks, fixtures, and optional ast-grep proof points.

## Feature Reference Vocabulary

The feature reference uses related but separate vocabularies. Feature entry status describes whether Skillset owns a feature at all. Target support status describes whether a target can represent that feature. Runtime support uses the same status values as target support for runtime, distribution, and harness records. [Render results](render-results.md) use a separate build-result vocabulary for what happened to a specific source unit in a specific build.

### Feature Entry Status

| Status | Meaning |
| --- | --- |
| `implemented` | Parsed, validated, rendered or reported, tested, and documented in the current compiler. |
| `planned` | Accepted design with no parser/render support yet. |
| `reserved` | Recognized vocabulary that fails until behavior and provenance exist. |
| `deferred` | Intentionally not rendered or implemented yet; documented reason. |
| `future` | Outside the v1 contract but tracked as a possible later design. |
| `unsupported` | Known not to be supported as a Skillset source feature. |

### Target Support Status

| Status | Meaning |
| --- | --- |
| `native` | The target has a native documented surface for the feature. |
| `pass_through` | Skillset can safely copy or preserve target-native source for that target. |
| `transformed` | Skillset can render the source intent into a different target-native shape. |
| `metadata_only` | Skillset can preserve the information in metadata, sidecars, locks, or reports, but the target does not enforce it directly. |
| `degraded` | Skillset can render a useful fallback that is weaker than native target support and must carry a reason. |
| `externally_managed` | The behavior belongs to install, activation, distribution, marketplace state, or another external system. |
| `shimmed` | Runtime behavior can work through deliberate compatibility instructions or harness material, but is not target-enforced. |
| `not_applicable` | The feature is a Skillset workflow or source-management surface rather than a target runtime feature. |
| `planned` | Target support is accepted but not implemented. |
| `future` | Target support is possible later but outside the v1 contract. |
| `unsupported` | The target cannot represent the feature faithfully through a portable render and must carry a reason. |
| `lossy` | A possible target render would drop required meaning or behavior and must carry a reason. |

Unsupported and lossy render must fail loudly by default. Softer policies such as warn, skip, or force require visible diagnostics and lock or doctor provenance before they can become runtime behavior.

### Render-Result Status

Render-result statuses are build-result facts, not registry capability statuses. A target support row that says `native` usually produces a `rendered` render result when a source unit is built; a row that says `pass_through` usually produces `target_native`; and a row that says `unsupported` may produce `unsupported`, `intentionally_skipped`, or no render result when the source unit is outside the current build scope. See [Render Results](render-results.md#render-result-statuses) for the full render-result table.

## Registry Shape

Each feature page uses the same registry-oriented fields. The current typed seed lives in `packages/core/src/feature-registry.ts`; feature pages remain the reader-facing explanation for those registry facts:

| Field | Purpose |
| --- | --- |
| Feature id | Stable id for docs, diagnostics, and future registry entries. |
| Source shape | Source paths, config keys, frontmatter keys, defaults, and conventional discovery. |
| Target support | Per-target support status, output paths, target-native escape hatches, and unsupported cases. |
| Render owner | Whether behavior belongs to the portable resolver, the Claude adapter, the Codex adapter, or a target-native pass-through. |
| Validation | Source checks, build/verify diagnostics, and structured output validation ownership. |
| Provenance | Lock entries, hashes, warnings, skipped output, target state, and explain/doctor surfaces. |
| Evidence | Provider docs, ADRs, Linear issues, tests, and fixtures that justify the current status. |

Future schema generation can turn these fields into richer generated docs, but the registry source of truth belongs in `@skillset/core`; the CLI should render registry-backed facts rather than own feature semantics.

## Future-Only Features

These are tracked as future/reserved unless a later issue promotes them:

- [Reviewed settings suggestion workflow](../adrs/drafts/20260604-reviewed-settings-suggestions.md): Skillset may eventually propose or review target settings changes, but `skillset build` must not mutate user-level Claude or Codex config.
- [Source Suggestions](source-suggestions.md): managed generated-output edit recovery remains future-only until SET-151 and SET-152 implement local suggestions and CI writeback.
- [Model and reasoning alias profiles](../adrs/drafts/20260604-model-and-reasoning-alias-profiles.md): shared aliases such as `review`, `fast`, or `deep` remain deferred; use target-native model and effort fields where supported.
- [First-class sets](../adrs/drafts/20260604-first-class-sets.md): grouped marketplaces, bundles, and curated collections remain future vocabulary; v1 keeps build scopes and entity selectors separate.
- [Tests and evals](tests-and-evals.md): adapter-aware eval support and expanded test selectors remain planned/future; deterministic `skillset test` has a first isolated rendering slice.
- Generated feature docs: docs remain manual until the feature reference shape is stable enough to generate from typed registry data.

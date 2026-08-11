---
description: The feature reference routes authors to exact Skillset contracts, workflow references, support vocabulary, and maintainer evidence.
---

# Feature Reference

The feature reference explains how authored source maps to provider [targets](../../glossary.md#target), which features are portable, which are [provider-native](../../glossary.md#provider-native), and which boundaries are not implemented. Feature prose remains human-owned; each delimited support matrix is rendered from the typed registry and checked for [drift](../../glossary.md#drift).

Start with the page matching the source or workflow you are using. To compare support across every provider, open the generated [feature support matrix](../support-matrix.md).

Use these pages alongside the authored [provider reference](../providers/README.md). Provider pages explain target-level judgment; feature pages own exact authoring shape, defaults, output, errors, examples, and caveats.

## Feature and Workflow Pages

- [Activation Probes](tests-and-evals.md#activation-probes): target-aware manual harness prompts generated inside `skillset test` runs.
- [Agents](agents.md): portable project agents, Claude and Cursor plugin agents, Codex project agents, and skill-local policy boundaries.
- [Apps](apps.md): Codex plugin `.app.json` pass-through and why there is no v1 `apps.source` feature key.
- [Build Scopes](build-scopes.md): build mode, [destination](../../glossary.md#destination) scopes, preview safety, diff/list/explain behavior, and lock semantics.
- [Changes](changes.md): pending change entries, source coverage, compact refs, groups, and append-only history boundaries.
- [CI](ci.md): the `skillset check --ci` aggregate check, mechanical drift rebuilds, PR-comment reports, and the `--include ci` workflow scaffold.
- [Commands](commands.md): Claude and Cursor plugin command pass-through, provider-native wiring, and Codex unsupported boundaries.
- [Dependencies](dependencies.md): plugin dependency declarations, Claude rendering, Codex fallback notices, and provenance.
- [Dev Watch](dev-watch.md): default-preview `skillset dev` for first-author source diagnostics, [generated-output](../../glossary.md#generated-output) drift, and explicit write mode.
- [Distributions](distributions.md): post-build distribution planning, destination reports, and build/distribution/activation boundaries.
- [Executables](executables.md): Claude plugin `bin/` conventional discovery, `bin.source`, and Codex unsupported diagnostics.
- [Feature Source Pointers](feature-source-pointers.md): direct feature-key source pointers, conventional discovery, and future component ownership.
- [Hooks](hooks.md): native aggregate hook emission, adaptive hook units, target validation, and activation boundaries.
- [Instructions](instructions.md): [source-root](../../glossary.md#source-root) `rules/` rendering to Claude rules, Codex `AGENTS.md`, and Cursor `.mdc` rules, with preprocessing and collision safety.
- [LSP Servers](lsp-servers.md): Claude plugin `.lsp.json` pass-through, manifest wiring, and future validation boundaries.
- [Marketplaces](marketplaces.md): curated provider catalogs, external plugin references, readiness states, and check/update boundaries.
- [MCP Servers](mcp-servers.md): plugin `.mcp.json`, `mcp.source`, manifest wiring, and structured validation.
- [Monitors](monitors.md): Claude experimental monitor pass-through, manifest wiring, and Codex unsupported boundaries.
- [Output Safety](output-safety.md): managed output ownership, unmanaged neighbor handling, reversible backups, and restore.
- [Output Styles](output-styles.md): Claude output style directory pass-through and manifest wiring.
- [Plugins](plugins.md): plugin source identity, manifest rendering, companion paths, and plugin boundaries.
- [Releases And Changelogs](releases.md): release state, generated changelog renderings, version planning, and package-tool interop.
- [Resources](resources.md): shared resource declarations, link rewriting, executable-script linting, and lock hashing.
- [Runtime Activation Readiness](runtime-activation-readiness.md): registry-backed activation requirements, deterministic summary semantics, and the boundary between rendering, observation, and proof.
- [Settings](settings.md): future reviewed settings suggestion workflow and why build does not mutate runtime config.
- [Skills](skills.md): standalone and plugin-bound skill frontmatter, target rendering, versions, metadata, and generated sidecars.
- [Source Suggestions](source-suggestions.md): implemented local managed-output reconciliation with source-side recovery suggestions, distinct from settings suggestions; CI writeback remains future work.
- [Supports](supports.md): compatibility metadata, support ranges, source significance, and release severity boundaries.
- [Provider Source](target-native-islands.md): explicit provider-native source islands, Codex `.rules` pass-through, and leakage rules.
- [Tests and Evals](tests-and-evals.md): deterministic `skillset test`, runtime probes, skill evals, and generated run-output boundaries.
- [Themes](themes.md): Claude experimental theme pass-through, manifest wiring, and Codex unsupported boundaries.
- [Tools Policy](tools-policy.md): portable tool policy, Claude tool-rule rendering, provider metadata, and target-native provider blocks.
- [Version Audit](version-audit.md): read-only version-locus audit across source, release state, generated output, and future destinations.

## Maintainer References

- [Feature Registry](../../development/features/feature-registry.md) owns typed feature IDs, support claims, documentation links, and evidence requirements.
- [Hook Guardrails](../../development/features/hook-guardrails.md) documents repository and agent-runtime check integration.
- [Render Results](../../development/features/render-results.md) defines the per-build result vocabulary used by adapters and reports.
- [Runtime Adapters](../../development/features/runtime-adapters.md) records runtime, distribution, and harness evidence separately from compiler targets.
- [Workbench Check](../../development/features/workbench.md) defines parser, schema, diagnostic, fixture, and optional static-analysis internals.

## Support Vocabulary

The feature reference uses related but separate vocabularies. Feature entry status describes whether Skillset owns a feature at all. Target support status describes whether a target can represent that feature. Runtime support uses the same status values as target support for runtime, distribution, and harness records. [Render results](../../development/features/render-results.md) use a separate build-result vocabulary for what happened to a specific [source unit](../../glossary.md#source-unit) in a specific build.

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

Unsupported and lossy render fails loudly by default. The implemented `warn`, `skip`, and `force` policies soften only those results while preserving visible diagnostics and lock or status provenance; failed render results still block.

### Render-Result Status

Render-result statuses are build-result facts, not registry capability statuses. A target support row that says `native` usually produces a `rendered` render result when a source unit is built; a row that says `pass_through` usually produces `target_native`; and a row that says `unsupported` may produce `unsupported`, `intentionally_skipped`, or no render result when the source unit is outside the current build scope. See [Render Results](../../development/features/render-results.md#render-result-statuses) for the full render-result table.

## Registry Linkage

The typed registry lives in `packages/core/src/feature-registry.ts`. Generated blocks are the canonical feature-ID and support surface; one page may explain several related registry entries. Cross-command references such as [Interactive CLI](interactive-cli.md), [Runtime Activation Readiness](runtime-activation-readiness.md), and [Source Suggestions](source-suggestions.md) are reader references without invented registry IDs.

The registry owns feature status, target support, documentation links, render owners, validation owners, and evidence references. The authored page explains how to use and interpret those facts without reproducing the exhaustive inventory.

## Future-Only Features

These are tracked as future/reserved unless a later issue promotes them:

- [Reviewed settings suggestion workflow](../../adrs/drafts/20260604-reviewed-settings-suggestions.md): Skillset may eventually propose or review target settings changes, but `skillset build` must not mutate user-level Claude, Codex, or Cursor config.
- [Model and reasoning alias profiles](../../adrs/drafts/20260604-model-and-reasoning-alias-profiles.md): shared aliases such as `review`, `fast`, or `deep` remain deferred; use target-native model and effort fields where supported.
- [First-class sets](../../adrs/drafts/20260604-first-class-sets.md): grouped marketplaces, bundles, and curated collections remain future vocabulary; v1 keeps build scopes and entity selectors separate.

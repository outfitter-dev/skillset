---
slug: source-test-selection-shape
title: Source Test Selection Shape
status: draft
created: 2026-06-22
updated: 2026-06-22
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, unified-source-layout, fixtures-tests-dogfooding-and-evals, deterministic-projection-and-adapter-conformance]
---

# ADR: Source Test Selection Shape

## Context

The first `skillset test` slice proves that an isolated build can render source and check generated files. The current self-hosted declaration is intentionally small but awkward:

```yaml
tests:
  self-hosted:
    assertions:
      - build
      - exists: plugins-claude/plugins/skillset/.claude-plugin/plugin.json
      - exists: plugins-codex/plugins/skillset/.codex-plugin/plugin.json
      - contains:
          path: plugins-codex/plugins/skillset/.codex-plugin/plugin.json
          text: '"name": "skillset"'
      - noDrift
    output:
      kind: isolated
    source: repo:.
```

That shape exposes too much generated-path ceremony. Authors have to know provider output roots, plugin manifest locations, and provider manifest fields even for checks Skillset can derive from the source graph. It also keeps test declarations in the workspace manifest, which is convenient for the first implementation slice but will become noisy as projects add more than one scenario.

We need a better source-facing shape before the first test surface becomes habit. The shape should follow existing Skillset doctrine:

- source selection is different from destination/build scope;
- authors should select source-owned things, not generated filenames;
- provider-specific output details should be derived when Skillset already knows them;
- ordinary and dedicated layouts should mean the same thing at the config-key level.

## Decision

Deterministic test declarations should move into the active source root, not a workspace-level manifest section as the primary authoring surface.

For ordinary repos, the source-root test files are:

```text
.skillset/src/tests.yaml
.skillset/src/tests/<test-name>.yaml
```

For dedicated Skillset repos, the equivalent files are:

```text
skillset/tests.yaml
skillset/tests/<test-name>.yaml
```

The two forms join into one test map. A single `tests.yaml` can hold many tests:

```yaml
self-hosted:
  select:
    plugins: ["skillset"]
  checks:
    projection: true
    pluginManifests: true
```

A split file has the same inner shape:

```yaml
# skillset/tests/self-hosted.yaml
select:
  plugins: ["skillset"]
checks:
  projection: true
  pluginManifests: true
```

Duplicate test names across aggregate and split files should fail with both source paths. Tests remain source declarations; they are not internal compiler fixtures and they do not duplicate skills, plugins, agents, or instructions as a parallel source tree.

### Selection Uses Source Concepts

Tests should use `select`, not `subject`, to name the source units being proven.

```yaml
self-hosted:
  select:
    plugins: ["skillset"]
    skills:
      primary: ["skillset-codex-development"]
```

`select` filters source entities. `targets` filters provider renderings. `--scope` remains destination filtering for commands that support it and should not become a source selector.

This means:

- `select.plugins: true` selects all plugin source families.
- `select.plugins: ["skillset"]` selects named plugin source families.
- `select.plugins.skills: true` selects plugin-bound skills through the plugin family.
- `select.plugins.include` can narrow the plugin set when the selector needs object shape.
- `select.skills: true` selects all skills, regardless of whether they are primary or plugin-bound.
- `select.skills.primary: true` selects skills directly under the active source root's `skills/` family.
- `select.skills.plugin: true` is available as the skills-family spelling for plugin-bound skills, but `select.plugins.skills` is the clearer shape when the test starts from plugins.

`primary` is the author-facing term for top-level source-root skills. It deliberately does not distinguish `.skillset/src/skills/` from `skillset/skills/`, and it avoids overloading `local`, `global`, `repo`, `root`, or the colder compiler term `standalone`.

Examples:

```yaml
all-skills:
  select:
    skills: true
  checks:
    projection: true
```

```yaml
primary-skills:
  select:
    skills:
      primary: true
  checks:
    projection: true
```

```yaml
plugin-skills:
  select:
    plugins:
      include: ["skillset"]
      skills: true
  checks:
    projection: true
```

When `select.plugins: true` appears without further narrowing, Skillset should treat it as the whole plugin source family: plugin config, manifest metadata, plugin-bound skills, and supported plugin companion features. More specific object forms can narrow to config-only, skills-only, or feature-only behavior later, but the broad boolean should mean "prove the plugin," not "prove only the plugin's manifest file."

### Checks Should Absorb Common Provider Ceremony

Tests should prefer high-level checks over generated path assertions for common Skillset promises.

```yaml
self-hosted:
  select:
    plugins: ["skillset"]
  targets:
    - claude
    - codex
  output:
    kind: isolated
  checks:
    projection: true
    pluginManifests: true
```

`projection: true` means the isolated test workspace builds successfully after pruning unselected source units, and the selected source projection has no generated-output drift after the build.

`pluginManifests: true` means Skillset derives the enabled provider targets, output roots, plugin ids, provider manifest paths, and expected manifest identity from the selected plugins. For each selected plugin and target, Skillset should check that the provider manifest exists, parses as JSON where applicable, has the expected name/version/metadata fields, and is covered by generated-output provenance.

Low-level file checks remain an escape hatch. The first implementation accepts explicit generated paths:

```yaml
custom-manifest-field:
  select:
    plugins: ["skillset"]
  checks:
    pluginManifests: true
    files:
      - path: plugins-codex/plugins/skillset/.codex-plugin/plugin.json
        contains: '"someCustomField": true'
```

Provider-relative output selectors such as `output: plugin`, `target: codex`, and `path: .codex-plugin/plugin.json` remain a future improvement once the test runner has a concrete source-to-output selection layer.

The old workspace-manifest `assertions` vocabulary was useful for the first implementation slice, but it should not become part of the public source-test contract. This ADR is a clean cutover: source-root tests use `checks`, and the implementation should migrate this repo's existing self-hosted declaration rather than carrying long-lived `assertions` compatibility.

### Plugin-Local Defaults Stay Deferred

Plugin configuration may eventually accept lightweight test enablement:

```yaml
tests: true
```

or:

```yaml
tests: ["self-hosted"]
```

That should wait until the source-root test declaration contract is implemented. Starting with explicit source-root tests keeps the first public shape inspectable and avoids creating a second plugin inventory parallel to the source tree.

### Run Output Follows Operational State Layout

Test declarations are authored source and should live under the active source root. Test run output is operational state and should not sit beside authored declarations.

The default retained run output should follow the current workspace operational layout:

```text
.skillset/cache/tests/latest/
.skillset/cache/tests/runs/<run-id>/
```

If a future mode stores per-repo test output in a global XDG cache, it should use the same stable repo-key bucket as other per-repo operational output:

```text
$XDG_CACHE_HOME/skillset/<owner>--<repo>/tests/latest/
$XDG_CACHE_HOME/skillset/<owner>--<repo>/tests/runs/<run-id>/
```

Global test output must remain rebuildable/cache-like. Authored test declarations, change state, locks, generated changelog projections, and source truth stay in the workspace. Global cache may index or mirror runs so agents can find them from anywhere, but it should not become the canonical home for authored tests.

## Consequences

### Positive

- Authors can prove common Skillset source promises without copying provider output paths into every test.
- The same test keys work for ordinary and dedicated layouts because the source root is resolved before reading tests.
- `select.skills: true` matches the human reading of "skills in general," while `skills.primary` gives precise control without leaking layout names.
- Built-in checks let Skillset codify common provider manifest expectations once instead of making every plugin author rediscover them.
- Existing source selectors, build scopes, and target selection stay separate.

### Tradeoffs

- Source pruning is source-family based in v1; finer-grained feature and provider-relative file selectors can build on the same selector vocabulary later.
- `primary` is a new author-facing term and must be defined consistently in docs, diagnostics, and future schema messages.
- Supporting both aggregate and split test files adds collision handling and provenance responsibility.
- Existing self-hosted tests need a one-time migration from workspace-manifest `assertions` to source-root `checks`.

### Risks

- `select.plugins: true` could feel too broad if authors expect only plugin manifests. Mitigation: document it as the plugin source family and provide explicit narrowing keys.
- `select.skills.plugin` and `select.plugins.skills` can overlap. Mitigation: normalize both to the same plugin-bound skill source units and prefer `select.plugins.skills` in examples that start from plugins.
- Built-in checks can hide target-specific truth if they become vague. Mitigation: every high-level check should expand toward concrete provider-target facts in the test report.

### What This Does NOT Decide

- It does not define provider-relative low-level file checks.
- It does not require a long-lived compatibility path for workspace-manifest `tests`; implementation should treat the existing shape as pre-public scaffolding to migrate cleanly.
- It does not define eval declarations.
- It does not define runtime activation, trust, install, or publish behavior.
- It does not decide every future selector for agents, instructions, target-native islands, dependencies, or sets.

## References

- [Tenets](../../tenets.md) - source-first loadouts, derive by default, and target truth.
- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - governing source and generated-output doctrine.
- [ADR-0001: Root Compile Policy](../0001-root-compile-policy.md) - compile targets remain provider selection, not source selection.
- [Unified Source Layout](20260618-unified-source-layout.md) - ordinary and dedicated repos share one source-root model.
- [Fixtures, Tests, Dogfooding, and Evals](20260609-fixtures-tests-dogfooding-and-evals.md) - original reserved deterministic test surface.
- [Deterministic Projection and Adapter Conformance](20260613-deterministic-projection-and-adapter-conformance.md) - isolated projection and adapter conformance context.
- [Tests and Evals](../../features/tests-and-evals.md) - current feature-facing test boundary.

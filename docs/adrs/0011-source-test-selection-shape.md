---
id: 11
slug: source-test-selection-shape
title: Source Test Selection Shape
status: accepted
created: 2026-06-22
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, 9]
---

# ADR-0011: Source Test Selection Shape

## Context

Before the accepted source-test cutover, the first `skillset test` slice proved
an isolated build through a workspace-manifest declaration with generated-path
assertions:

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
- one flat workspace layout should own one declaration shape.

## Decision

Deterministic test declarations live in the active `.skillset/` source root,
not in the workspace manifest. The supported files are:

```text
.skillset/tests.yaml
.skillset/tests/<test-name>.yaml
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
# .skillset/tests/self-hosted.yaml
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

`primary` is the author-facing term for top-level `.skillset/skills/`. It avoids overloading `local`, `global`, `repo`, `root`, or the colder compiler term `standalone`.

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

When `select.plugins: true` appears without further narrowing, Skillset treats it as the whole plugin source family: plugin config, manifest metadata, plugin-bound skills, and supported plugin companion features. More specific object forms can narrow the set, but the broad boolean means "prove the plugin," not "prove only the plugin's manifest file."

### Checks Absorb Common Provider Ceremony

Tests prefer high-level checks over generated path assertions for common Skillset promises.

```yaml
self-hosted:
  select:
    plugins: ["skillset"]
  targets:
    - claude
    - codex
    - cursor
  output:
    kind: isolated
  checks:
    projection: true
    pluginManifests: true
```

`projection: true` means the isolated test workspace builds successfully after pruning unselected source units, and the selected source projection has no generated-output drift after the build.

`pluginManifests: true` means Skillset derives the enabled provider targets, output roots, plugin ids, provider manifest paths, and expected manifest identity from the selected plugins. For each selected plugin and target, Skillset checks that the provider manifest exists, parses as JSON where applicable, has the expected identity fields, and is covered by generated-output provenance.

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

The old workspace-manifest `assertions` vocabulary was first-slice scaffolding
and is retired. Source-root tests use `checks`; the self-hosted declaration was
migrated without long-lived `assertions` compatibility.

### Plugin-Local Defaults Stay Deferred

Plugin configuration may eventually accept lightweight test enablement:

```yaml
tests: true
```

or:

```yaml
tests: ["self-hosted"]
```

That remains deferred. Explicit source-root tests keep the current public shape inspectable and avoid creating a second plugin inventory parallel to the source tree.

### Run Output Follows Operational State Layout

Test declarations are authored source and should live under the active source root. Test run output is operational state and should not sit beside authored declarations.

The default retained run output should follow the current workspace operational layout:

```text
.skillset/cache/tests/latest/
.skillset/cache/tests/runs/<run-id>/
```

These logical paths resolve through the repository's stable XDG cache bucket.
Run output remains rebuildable/cache-like. Authored test declarations, change
state, locks, generated changelog projections, and source truth stay in the
workspace; operational storage does not become the canonical home for tests.

## Consequences

### Positive

- Authors can prove common Skillset source promises without copying provider output paths into every test.
- One declaration shape works throughout the flat workspace.
- `select.skills: true` matches the human reading of "skills in general," while `skills.primary` gives precise control without leaking layout names.
- Built-in checks let Skillset codify common provider manifest expectations once instead of making every plugin author rediscover them.
- Existing source selectors, build scopes, and target selection stay separate.

### Tradeoffs

- Source pruning is source-family based in v1; finer-grained feature and provider-relative file selectors can build on the same selector vocabulary later.
- `primary` is an author-facing term and must stay consistent in docs, diagnostics, and schema messages.
- Supporting both aggregate and split test files adds collision handling and provenance responsibility.
- Existing self-hosted tests completed the one-time migration from workspace-manifest `assertions` to source-root `checks`.

### Risks

- `select.plugins: true` could feel too broad if authors expect only plugin manifests. Mitigation: document it as the plugin source family and provide explicit narrowing keys.
- `select.skills.plugin` and `select.plugins.skills` can overlap. Mitigation: normalize both to the same plugin-bound skill source units and prefer `select.plugins.skills` in examples that start from plugins.
- Built-in checks can hide target-specific truth if they become vague. Mitigation: every high-level check should expand toward concrete provider-target facts in the test report.

### What This Does NOT Decide

- It does not define provider-relative low-level file checks.
- It does not retain compatibility for the retired workspace-manifest `tests` shape.
- It does not define eval declarations.
- It does not define runtime activation, trust, install, or publish behavior.
- It does not decide every future selector for agents, instructions, target-native islands, dependencies, or sets.

## Acceptance Evidence (2026-07-20)

Declarations live at `.skillset/tests.yaml` and
`.skillset/tests/<name>.yaml`; aggregate and split forms merge into the same
canonical inventory. Implemented declarations use `select`, `targets`, and
`checks`, with derived projection and plugin-manifest checks plus an explicit
file escape hatch. Claude, Codex, and Cursor are first-class targets.

The test family now includes deterministic declarations, activation probes,
declared runtime literal assertions, and ad hoc runtime tests. Retained reports
use logical `.skillset/cache/tests/...` paths backed by repository XDG storage.
Plugin-local declarations, provider-relative output selectors, and behavioral
evals remain outside this decision. The shared schema contracts, test runner,
CLI, contract/try tests, and `docs/features/tests-and-evals.md` are the current
implementation evidence; `.skillset/src/tests*` and root `skillset/tests*` are
retired paths.

## References

- [Tenets](../tenets.md) - source-first loadouts, derive by default, and target truth.
- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - governing source and generated-output doctrine.
- [ADR-0001: Root Compile Policy](0001-root-compile-policy.md) - compile targets remain provider selection, not source selection.
- [Skillset Workspace Layout](0009-skillset-workspace-layout.md) - current flat source-root model, superseding the earlier unified-layout proposal.
- [Fixtures, Tests, Dogfooding, and Evals](0012-fixtures-tests-dogfooding-and-evals.md) - original reserved deterministic test surface.
- [Deterministic Projection and Adapter Conformance](0019-deterministic-projection-and-adapter-conformance.md) - isolated projection and adapter conformance context.
- [Tests and Evals](../features/tests-and-evals.md) - current feature-facing test boundary.

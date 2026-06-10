---
slug: fixtures-tests-dogfooding-and-evals
title: Fixtures, Tests, Dogfooding, and Evals
status: draft
created: 2026-06-09
updated: 2026-06-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, feature-reference-and-schema-registry, source-change-release-provenance, change-release-edge-decisions]
---

# ADR: Fixtures, Tests, Dogfooding, and Evals

## Context

Skillset now has enough surface area that the word "test" can mean several different things. The compiler has internal fixtures and contract tests. The self-hosted repo needs to dogfood source-change and release workflows. Authors may eventually want deterministic tests that project selected `.skillset/` source subjects into isolated output and assert the result. Claude and Codex also have emerging eval conventions for model-facing behavior, and those conventions do not share one obvious portable shape.

If these jobs collapse into one directory or command, Skillset will make the wrong abstraction public. A kitchen-sink compiler fixture could become a fake user-facing test. A dogfood checklist could become a public command that does not solve a user problem. A deterministic build assertion could be called an eval even though target evals include prompts, graders, baselines, token usage, and human review.

The current repo already separates some of these concerns:

- `fixtures/kitchen-sink/` is an internal fake repo source tree used by tests.
- `src/__tests__/` contains compiler, contract, and audit-hardening tests.
- `skillset check`, `doctor`, `diff`, `change check`, and `release plan` validate real source and generated output.
- The self-hosted `.skillset/` tree is real source, not fixture data.

The design question is where to draw the next boundary before implementing `skillset test`, lifecycle dogfooding, or eval support.

## Decision

Skillset separates fixtures, dogfooding, deterministic tests, and evals by purpose and authority.

### Fixtures Stay Internal

Fixtures are maintainer-owned fake repos for compiler tests. They stay outside `.skillset/` at repo root paths such as:

```text
fixtures/<case>/
  .skillset/
    config.yaml
    plugins/
    skills/
    instructions/
    src/
```

The fixture root should look like a realistic content repo so tests can copy `fixtures/<case>` into a temp directory and run Skillset commands with `--root <temp>`. In the current source contract, `.skillset/src/` is not the universal source root; it holds project agents and target-native islands, while plugins, standalone skills, and instructions live under their existing `.skillset/` directories. This keeps fixtures close to real authoring while preserving that they are implementation test material, not product source.

A bare `fixtures/.skillset/src/` shape is acceptable only when `fixtures/` itself is intentionally treated as one fake repo root. The preferred shape remains `fixtures/<case>/.skillset/...` because it scales to multiple cases and keeps the repository's internal fixture inventory distinct from the repository's live `.skillset/` source.

This means:

- `fixtures/` may contain `.skillset/` trees.
- `fixtures/` should not be scanned as the repo's own Skillset source.
- Internal compiler tests may assert exact generated files, lock entries, drift behavior, and negative diagnostics from fixtures.
- Moving or normalizing fixtures does not create a public source contract.

### Dogfooding Is Practice, Not Product API

Dogfooding is how the Skillset repo proves its own workflows. It uses real commands on real source changes, especially the change/release lifecycle:

```bash
skillset change status
skillset change add ...
skillset change check
skillset release plan
skillset release apply --yes
skillset check
```

Dogfooding should live in repo scripts, retros, Linear acceptance criteria, and actual use of the workflow. It should not become a top-level `skillset dogfood` command unless a later user-facing problem justifies it.

The first lifecycle dogfood target should be a small self-hosted `.skillset/` source edit that creates a pending reason, plans a release, applies it, refreshes generated output, and verifies no drift.

### Deterministic Tests Are Future Product Surface

`skillset test` is reserved for deterministic test runs that project selected source into isolated generated output and assert the result. It is not implemented by this ADR.

The v1 shape is selector-driven and root-config backed rather than taxonomy-driven. Root `.skillset/config.yaml` should own the first test declarations so the command proves existing source without turning `.skillset/tests/` into a parallel source tree:

```yaml
tests:
  self-hosted:
    source: repo:.skillset
    targets:
      - claude
      - codex
    output:
      kind: isolated
    assertions:
      - build
      - noDrift
      - exists: plugins-claude/plugins/skillset/.claude-plugin/plugin.json
```

The first implementation slice should support `repo:.skillset` by copying the current source root into an isolated run workspace and building it there. Typed source selectors such as `plugin:<name>`, `skill:<name>`, and internal `fixture:<case>` remain the intended grammar, but they should wait until source inventory and generated-output narrowing can be implemented consistently. `--scope` remains destination filtering; it is not a source selector.

Large tests may move into `.skillset/tests/`, but that directory should not appear until the user-facing contract is clearer than a fixture mirror. If it appears, it should reference existing `.skillset/` subjects or fixture sources; it should not duplicate skills, plugins, agents, or instructions as a parallel source tree.

Generated test output belongs under `.skillset/build/tests/`:

```text
.skillset/build/tests/
  latest/
  latest.json
  runs/<run-id>/
```

Each run writes a complete retained directory under `runs/<run-id>/`, including an isolated workspace plus `report.json` and `report.md`. `latest/` is a refreshed real directory copy of the most recent run rather than a symlink, and `latest.json` records the active run id, source selector, report path, and generated output path. Retention defaults to keeping prior runs; pruning is future configuration.

The first assertion vocabulary should stay small: `build` means the isolated build completed, `exists` checks a generated path, `contains` checks text inside a generated file, and `noDrift` runs a generated-output diff after the isolated build. Target validation commands are reportable manual follow-up instructions in v1, not executed runtime mutations.

Release state and inline versions are observable in test reports, not migrated by the test runner. This keeps the SET-43 inline-version migration future-scoped: deterministic tests may verify that release state wins over source version fallbacks, but `skillset test` must not rewrite source `version` fields or introduce migration warnings.

### Evals Are Adapter-Aware Future Surface

Evals are behavioral and model-facing. They ask whether a skill, plugin, or agent helps an agent do the job. They may include prompts, baselines, graders, benchmark workspaces, measured token usage, reports, and human review.

Skillset should not flatten Claude and Codex eval conventions into deterministic tests. Future eval support should be adapter-aware and may point at target-native eval files:

```yaml
evals:
  claude:
    source: repo:evals/claude/skillset/evals.json
  codex:
    source: repo:evals/codex/skillset/benchmark.json
```

Generated eval output belongs under `.skillset/build/evals/` if and when evals become a Skillset surface. That keeps deterministic test output and model-facing eval output separate while sharing the broader generated build root.

Eval execution is opt-in. It must not become part of ordinary `skillset check` or `bun run check` until a specific eval mode is proven deterministic, local, credential-free, and side-effect-free. Target eval harnesses may require API keys, write their own benchmark setup files, or modify target runtime config, so Skillset should start by documenting and pointing at target-native eval conventions rather than wrapping them as normal compiler tests.

### Build Root Carries Generated Experimental Output

`.skillset/build/` is the gitignored home for generated Skillset working output that is not ordinary target projection. It can hold future preview, test, and eval outputs without confusing them with source or real generated destinations.

This naming is preferred over hidden sibling directories such as `.skillset/.tests/` because `build/` makes the source/output boundary explicit.

## Consequences

### Positive

This keeps internal fixtures useful without making them part of the public source model. It gives the change/release workflow a dogfood path that uses real commands and real source. It leaves room for `skillset test` without overcommitting the `.skillset/tests/` taxonomy. It also keeps future eval support compatible with Claude and Codex conventions instead of forcing one portable eval schema too early.

### Tradeoffs

The cost is slower implementation of `skillset test`. Skillset will continue to rely on compiler fixtures and real dogfooding before a public deterministic test runner exists. Authors who want declarative tests immediately will need to use repo scripts or existing validation commands.

### What This Does NOT Decide

This ADR does not implement every selector, define a `.skillset/tests/` schema, define an eval schema, start the inline-version migration, or decide how marketplace runtime testing is installed or activated. It does not change build semantics for real target output.

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - source and generated-output doctrine.
- [Feature Reference and Schema Registry](20260604-feature-reference-and-schema-registry.md) - feature docs and future registry direction.
- [Source Change, Release, and Dependency Provenance](20260609-source-change-release-provenance.md) - source-change and release workflow this dogfood boundary must prove.
- [Change and Release Edge Decisions](20260609-change-release-edge-decisions.md) - release and baseline edge decisions that should not be hidden in test fixtures.
- [Tests and Evals](../../features/tests-and-evals.md) - feature-facing reference for the reserved test/eval surfaces.

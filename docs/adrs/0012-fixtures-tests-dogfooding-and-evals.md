---
id: 12
slug: fixtures-tests-dogfooding-and-evals
title: Fixtures, Tests, Dogfooding, and Evals
status: accepted
created: 2026-06-09
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 5, 11]
---

# ADR-0012: Fixtures, Tests, Dogfooding, and Evals

## Context

Skillset uses the word "test" for several different things. The compiler has
internal fixtures and contract tests, the self-hosted repo dogfoods source-change
and release workflows, and authors can declare deterministic tests that project
selected `.skillset/` source into isolated output. Provider eval conventions
for model-facing behavior remain a separate future surface.

If these jobs collapse into one directory or command, Skillset will make the wrong abstraction public. A kitchen-sink compiler fixture could become a fake user-facing test. A dogfood checklist could become a public command that does not solve a user problem. A deterministic build assertion could be called an eval even though target evals include prompts, graders, baselines, token usage, and human review.

The current repo already separates some of these concerns:

- `fixtures/kitchen-sink/` is an internal fake repo source tree used by tests.
- `apps/skillset/src/__tests__/` and `packages/*/src/__tests__/` contain compiler, contract, and audit-hardening tests.
- `skillset check`, `status`, `diff`, `change check`, and `release plan` validate real source and generated output.
- The self-hosted `.skillset/` tree is real source, not fixture data.

This decision fixes the authority boundary among implemented deterministic and
runtime tests, repository dogfooding, internal fixtures, and future evals.

## Decision

Skillset separates fixtures, dogfooding, deterministic tests, and evals by purpose and authority.

### Fixtures Stay Internal

Fixtures are maintainer-owned fake repos for compiler tests. They stay outside `.skillset/` at repo root paths such as:

```text
fixtures/<case>/
  skillset.yaml
  .skillset/
    plugins/
    skills/
    rules/
    agents/
    _claude/
    _codex/
    _cursor/
```

The fixture root looks like a realistic content repo so tests can copy
`fixtures/<case>` into a temp directory and run Skillset commands with `--root
<temp>`. It uses root `skillset.yaml` plus the flat `.skillset/` workspace.
This keeps fixtures close to real authoring while preserving that they are
implementation test material, not product source.

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

Lifecycle dogfooding uses small self-hosted `.skillset/` source edits that create
pending reasons, plan releases, refresh generated output, and verify drift.

### Deterministic Tests Are Implemented Product Surface

`skillset test` runs deterministic declarations from `.skillset/tests.yaml` and
`.skillset/tests/*.yaml`. Declarations select existing source and provider
targets, then request typed checks without duplicating source units:

```yaml
self-hosted:
  select:
    plugins: [skillset]
  targets: [claude, codex, cursor]
  checks:
    projection: true
    pluginManifests: true
```

The runner copies selected source into an isolated run workspace and builds it
there. `select` owns source selection, `targets` owns provider selection, and
`checks` owns projection, manifest, and explicit file assertions. `--scope`
remains destination filtering rather than a source selector. Split declaration
files reference existing source; they do not duplicate skills, plugins, agents,
or instructions as a parallel tree.

Generated test output belongs under `.skillset/cache/tests/`:

```text
.skillset/cache/tests/
  latest/
  latest.json
  runs/<run-id>/
```

Each run writes a complete retained directory under `runs/<run-id>/`, including an isolated workspace plus `report.json` and `report.md`. `latest/` is a refreshed real directory copy of the most recent run rather than a symlink, and `latest.json` records the active run id, source selector, report path, and generated output path. Retention defaults to keeping prior runs; pruning is future configuration.

The check vocabulary stays small and typed. Projection and plugin-manifest
checks derive common provider facts, while explicit file checks are the escape
hatch. Activation probes and declared/ad hoc runtime tests remain distinct from
deterministic compiler assertions.

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

Generated eval output belongs under `.skillset/cache/evals/` if and when evals become a Skillset surface. That keeps deterministic test output and model-facing eval output separate while sharing the broader operational cache root.

Eval execution is opt-in. It must not become part of ordinary `skillset check` or `bun run check` until a specific eval mode is proven deterministic, local, credential-free, and side-effect-free. Target eval harnesses may require API keys, write their own benchmark setup files, or modify target runtime config, so Skillset should start by documenting and pointing at target-native eval conventions rather than wrapping them as normal compiler tests.

### Cache Root Carries Generated Experimental Output

`.skillset/cache/` is the logical gitignored boundary for delete-safe generated
Skillset working output that is not ordinary target projection. Test paths are
backed by the repository's XDG cache bucket. Future eval output may use a
separate logical namespace. Recovery snapshots remain separate under
`.skillset/snapshots/`.

This naming is preferred over hidden sibling directories such as `.skillset/.tests/` because `cache/` makes the delete-safe generated-output boundary explicit.

## Consequences

### Positive

This keeps internal fixtures useful without making them part of the public source model. It gives the change/release workflow a dogfood path that uses real commands and real source. It provides a bounded deterministic/runtime test family while keeping future eval support adapter-aware instead of forcing one portable eval schema too early.

### Tradeoffs

The cost is maintaining clear boundaries among compiler fixtures, declarations,
runtime evidence, and future evals. Adding selectors or checks raises the public
contract review bar.

### What This Does NOT Decide

This ADR does not implement every selector, define an eval schema, start the
inline-version migration, or decide how marketplace runtime testing is installed
or activated. It does not change build semantics for real target output.

## Acceptance Evidence (2026-07-20)

Internal fixtures use root `skillset.yaml` plus flat `.skillset/`;
contract suites live under `apps/skillset/src/__tests__/` and
`packages/*/src/__tests__/`. User declarations at `.skillset/tests.yaml` and
`.skillset/tests/*.yaml` implement deterministic `select`/`targets`/`checks`.
Activation probes, declared runtime literal assertions, ad hoc runtime tests,
and Cursor execution are implemented, with retained evidence stored through
logical XDG-backed `.skillset/cache/tests/` paths.

Compiler fixtures, repository dogfooding, deterministic tests, runtime tests,
and evals remain distinct evidence classes. The external conformance lane is
optional and outside ordinary checks. Behavioral evals remain future,
adapter-aware, credential-sensitive, and opt-in; this decision does not claim
an eval runner. Current proof is in `docs/features/tests-and-evals.md`, shared
schema contracts, test CLI/runner code, contract and runtime tests, and the
bounded external harness.

## References

- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - source and generated-output doctrine.
- [Feature Reference and Schema Registry](0005-feature-reference-and-schema-registry.md) - current feature docs and registry direction.
- [Source Change, Release, and Dependency Provenance](0014-source-change-release-provenance.md) - source-change and release workflow this dogfood boundary must prove.
- [Change and Release Edge Decisions](0016-change-release-edge-decisions.md) - implemented release-edge decisions and the explicitly unresolved baseline boundary that test fixtures must not hide.
- [Tests and Evals](../features/tests-and-evals.md) - feature-facing reference for current tests and future evals.

# Tests and Evals

Feature id: `tests-and-evals`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Tests and evals are reserved future surfaces. They are related because both prove confidence in a Skillset loadout, but they answer different questions. Deterministic tests ask whether selected source projects into expected files and lifecycle state. Evals ask whether a skill, plugin, or agent helps a model do the intended work.

## Current Boundary

Skillset currently uses internal compiler fixtures and validation commands:

| Surface | Location | Status | Purpose |
| --- | --- | --- | --- |
| Internal fixtures | `fixtures/<case>/.skillset/` ([convention](../../fixtures/README.md)) | `implemented` / internal | Fake repos copied into temp directories by compiler tests. |
| Contract tests | `src/__tests__/` | `implemented` / internal | Unit, contract, and audit-hardening tests for compiler behavior. |
| Validation commands | `skillset check`, `doctor`, `diff`, `change check`, `release plan` | `implemented` | Public commands that validate real source and generated output. |
| Dogfooding | repo scripts, Linear acceptance criteria, real Skillset source changes | internal practice | Proves workflows by using them on this repo. |
| `skillset test` | root `.skillset/config.yaml` `tests` entries | `implemented` / first slice | Deterministic isolated projection and assertion runner. |
| `.skillset/tests/` | n/a | `reserved` | Optional future authored test declarations; not a fixture mirror. |
| `.skillset/evals/` | n/a | `future` | Future adapter-aware behavioral eval declarations or pointers. |

Internal fixtures may include `fixtures/<case>/.skillset/src/` when a case needs project agents or target-native islands. A bare `fixtures/.skillset/src/` is acceptable only if `fixtures/` itself is intentionally the fake repo root; named fixture cases are preferred so the fixture inventory can grow without looking like live repo source.

## Deterministic Tests

`skillset test` runs isolated deterministic scenarios. It compiles selected `.skillset/` source subjects in a run workspace and asserts generated files, text, and drift without touching live target output.

The implemented v1 slice is selector-driven and config-backed. Root `.skillset/config.yaml` owns test declarations so authors can prove existing source without introducing a second source tree. `.skillset/tests/` remains reserved for larger declarations after the source contract is proven; if it appears later, it should reference existing source subjects rather than duplicating skills, plugins, agents, or instructions.

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

The first implementation slice supports `repo:.skillset`, which copies the current Skillset source root into an isolated run workspace and builds it there. If the repo has an existing workspace `.skillset.lock`, the test stages that lock too so source-adjacent generated projections such as entity `CHANGELOG.md` files remain recognized as managed inside the run. Typed source selectors such as `plugin:<name>`, `skill:<name>`, and internal `fixture:<case>` references remain the intended grammar, but they should be added only when selection narrows source inventory and generated output consistently. `--scope` continues to mean generated-destination filtering, not source selection, and `skillset test` rejects build/write flags such as `--scope`, `--yes`, `--dry-run`, `--updated`, `--all`, and `--dist`.

Generated test output should live under the gitignored build root:

```text
.skillset/build/tests/
  latest/
  latest.json
  runs/<run-id>/
```

Each run writes a complete retained directory under `runs/<run-id>/`, including the isolated workspace and `report.json` / `report.md`. `latest/` is a real refreshed copy of the most recent run, not a symlink, so local marketplaces or generated plugin trees can be inspected with stable paths on platforms where symlinks are fragile. `latest.json` records the active run id, source selector, report path, and generated output path. Retention defaults to keeping prior run directories; pruning is a future option rather than implicit cleanup.

The first assertion vocabulary is deliberately small: `build` means the isolated build command succeeded, `exists` checks for a generated file or directory, `contains` checks text in a generated file, and `noDrift` runs the generated-output diff after the isolated build. Target validation commands are reportable manual follow-up instructions in v1; `skillset test` does not install, publish, trust, symlink, or activate Claude/Codex runtime configuration.

Release state and inline versions are observable, not migrated, by deterministic tests. A test may assert the version that build emits after release state is applied, but it must not rewrite source `version` fields or start the SET-43 migration from inline versions to release-state-only authoring.

## Lifecycle Dogfooding

Lifecycle dogfooding is not a product command. It is how this repo proves that the change/release workflow is usable:

```bash
skillset change status
skillset change add ...
skillset change check
skillset release plan
skillset release apply --yes
skillset check
```

The first durable dogfood pass should use a small self-hosted `.skillset/` source edit, create a real pending reason, apply release state, refresh generated output, and confirm no drift. A separate fake-repo lifecycle fixture can cover edge cases, but it should not replace using the workflow on the real repo.

## Evals

Evals are future and adapter-aware. Claude and Codex evaluation conventions differ, so Skillset should start by pointing to target-native eval files rather than forcing one portable schema.

Possible future shape:

```yaml
evals:
  claude:
    source: repo:evals/claude/skillset/evals.json
  codex:
    source: repo:evals/codex/skillset/benchmark.json
```

Generated eval output, if Skillset owns it later, should live under:

```text
.skillset/build/evals/
  latest/
  latest.json
  runs/<run-id>/
```

Evals may include prompts, baselines, graders, benchmark workspaces, token measurements, reports, and human review. They should stay distinct from deterministic compile and lifecycle tests.

Eval execution should stay opt-in. Some target eval harnesses require credentials, write benchmark setup files, or touch target runtime configuration. Those workflows are useful, but they are not safe default checks and should not be wired into `skillset check` or repo `bun run check` until a specific mode is proven deterministic, local, credential-free, and side-effect-free.

## Diagnostics

- `skillset test` fails on missing declarations, unsupported source selectors, assertion failure, stale generated output inside the isolated run, malformed test declarations, and unsafe build/write flag combinations.
- Test runs report what they generated, what they asserted, where the retained run lives, and where the refreshed `latest/` output lives.
- Evals should identify whether a result is structural analysis, benchmark output, model behavior, or human review.
- Evals should distinguish read-only analysis from benchmark or runtime modes that write setup files, consume credentials, call providers, or mutate target runtime state.

## Provenance

Test runs record the source selector, target set, run id, generated output paths, assertion results, retained run path, and refreshed latest path in `report.json`, `report.md`, and `latest.json`. Eval runs should use the equivalent `.skillset/build/evals/` boundary if they become a Skillset surface later. This provenance belongs under `.skillset/build/tests/` or `.skillset/build/evals/`, not in ordinary generated target files.

## Evidence

See [Fixtures, Tests, Dogfooding, and Evals](../adrs/drafts/20260609-fixtures-tests-dogfooding-and-evals.md), [Build Scopes](build-scopes.md), [Changes](changes.md), and [Releases and Changelogs](releases.md).

# Tests and Evals

Feature id: `tests-and-evals`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Tests and evals are reserved future surfaces. They are related because both prove confidence in a Skillset loadout, but they answer different questions. Deterministic tests ask whether selected source projects into expected files and lifecycle state. Evals ask whether a skill, plugin, or agent helps a model do the intended work.

## Current Boundary

Skillset currently uses internal compiler fixtures and validation commands:

| Surface | Location | Status | Purpose |
| --- | --- | --- | --- |
| Internal fixtures | `fixtures/<case>/skillset.yaml` and `fixtures/<case>/skillset/` ([convention](../../fixtures/README.md)) | `implemented` / internal | Fake repos copied into temp directories by compiler tests. |
| Contract tests | `src/__tests__/` | `implemented` / internal | Unit, contract, and audit-hardening tests for compiler behavior. |
| Validation commands | `skillset check`, `skillset verify`, `doctor`, `diff`, `change check`, `release plan` | `implemented` | Public commands that validate real source and generated output. |
| Dogfooding | repo scripts, Linear acceptance criteria, real Skillset source changes | internal practice | Proves workflows by using them on this repo. |
| `skillset test` | workspace manifest `tests` entries | `implemented` / first slice | Deterministic isolated projection and assertion runner. |
| `.skillset/tests/` | n/a | `reserved` | Optional future authored test declarations; not a fixture mirror. |
| `.skillset/evals/` | n/a | `future` | Future adapter-aware behavioral eval declarations or pointers. |

Checked-in internal fixtures use the dedicated layout: `fixtures/<case>/skillset.yaml` as the workspace manifest and `fixtures/<case>/skillset/` as the source root. Inline temp fixtures may still use ordinary `.skillset/skillset.yaml` and `.skillset/src/` trees when they are testing ordinary workspace behavior directly.

## Deterministic Tests

`skillset test` runs isolated deterministic scenarios. It compiles selected workspace source subjects in a run workspace and asserts generated files, text, and drift without touching live target output.

The implemented v1 slice is selector-driven and config-backed. The workspace manifest owns test declarations so authors can prove existing source without introducing a second source tree. Ordinary repos use `.skillset/skillset.yaml`; dedicated Skillset repos use root `skillset.yaml`. `.skillset/tests/` remains reserved for larger declarations after the source contract is proven; if it appears later, it should reference existing source subjects rather than duplicating skills, plugins, agents, or instructions.

```yaml
tests:
  self-hosted:
    source: repo:.
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

The first implementation slice supports the active workspace source selector: `repo:.skillset` for ordinary repos and `repo:.` for dedicated Skillset repos. The test runner copies only source-relevant files into an isolated run workspace: ordinary workspaces stage `.skillset/`, while dedicated workspaces stage `skillset.yaml`, `skillset/`, and `changes/`. If the repo has an existing workspace `skillset.lock`, the test stages that lock too so source-adjacent generated renderings such as entity `CHANGELOG.md` files remain recognized as managed inside the run. Typed source selectors such as `plugin:<name>`, `skill:<name>`, and internal `fixture:<case>` references remain the intended grammar, but they should be added only when selection narrows source inventory and generated output consistently. `--scope` continues to mean generated-destination filtering, not source selection, and `skillset test` rejects build/write flags such as `--scope`, `--yes`, `--dry-run`, `--updated`, `--all`, and `--dist`.

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

## Activation Probes

Activation probes are a first layer above deterministic build assertions and below evals. They answer “can a target harness notice or invoke the expected skill, agent, or plugin?” They do not judge answer quality, call a model, install a plugin, trust global runtime config, or mutate live build roots.

Root test declarations can include lightweight activation probes:

```yaml
tests:
  activation:
    source: repo:.
    targets:
      - claude
      - codex
    activation:
      - name: fixture guidance
        prompt: Help me inspect this Skillset fixture setup.
        expect:
          skill: skillset-repo-test-fixtures
    assertions:
      - build
```

Each probe requires `prompt` and `expect`. The v1 `expect` object must name exactly one of `skill`, `agent`, or `plugin`. Probe `targets` can narrow to enabled test targets; absent probe targets inherit the enclosing test targets. Empty target arrays fail. Before a retained run is written, Skillset verifies that the expected unit was rendered for every selected target in the isolated workspace, so typos and target-disabled units fail without creating partial run directories. Probe assets are generated under the retained test run:

```text
.skillset/build/tests/runs/<run-id>/activation/<target>/
  probes.json
  <probe-name>.md
```

`latest/` receives the same activation directory when the run refreshes. Claude probes are rendered as manual native harness prompts. Codex probes are rendered as manual shim-aware prompts because Codex can follow generated loading instructions, but Skillset should not pretend that every Claude-style activation signal is target-enforced in Codex. Future Codex plugin-eval integration can consume the same `probes.json` shape once that runner boundary is proven.

Edge cases stay explicit: multiple matching skills should be disambiguated in the expected selector, provider source may need target-specific probes, missing plugin dependencies should appear as activation setup failures rather than build successes, and compatibility shims should be reported as shims in the generated probe material.

## Compiler Determinism and Adapter Conformance

The compiler verification lane is narrower than `skillset test` and much narrower than evals. It proves that the same source projects to the same generated artifacts, lockfiles, reports, and structured outcomes when built in clean roots. It is an internal and core-library-facing determinism proof, not a user-authored scenario format.

The default fast lane should run small local cases such as `fixtures/kitchen-sink/` and selected self-hosted source. Slower lanes can cover external adoption fixtures and larger conformance packs. Both lanes should share the same normalized output-tree utilities so path-level failures look the same.

This repo exposes the fast lane through targeted package scripts:

```bash
bun run conformance:determinism
bun run conformance:adapters
bun run conformance:fast
```

`bun run conformance:determinism` reruns the clean-root projection proofs for the checked-in kitchen-sink fixture and the self-hosted `skillset/` source selection. `bun run conformance:adapters` reruns adapter outcome and coverage tests against representative feature-registry claims. `bun run conformance:fast` runs both. These scripts are for focused maintainer reruns; the default `bun run check` gate already includes them through `bun run test`.

External adoption fixtures are the opt-in slower lane:

```bash
bun run conformance:external
bun run conformance:external -- <name>
bun run conformance:external:sync
```

The external lane reuses the pinned repo manifest in `fixtures/external/repos.yaml` and writes reports under `.skillset/build/external/<name>/`. Those reports are conformance evidence for real-world adoption and round-trip fidelity: they show which repo/ref was acquired, what adoption imported, whether lint/build/purity passed, and which generated paths matched or drifted. They are suitable as feature-registry or adapter coverage references, but they remain outside `bun run check`, `skillset:ci`, and PR CI because they may fetch network data and run against large cloned repos.

Normalization is intentionally limited. The runner may normalize path separators, strip only its own documented temp-root prefixes from comparison material, canonicalize JSON object key order for locks/reports/results, and exclude documented runner-retention metadata. Absolute source temp paths in generated files or hash material, timestamps in locks, unstable ordering, host-specific separators, and mismatched generated bytes should fail.

Adapter conformance consumes the feature registry and [render results](render-results.md) together. A target support row that says `native`, `transformed`, `pass_through`, `metadata_only`, `degraded`, or `unsupported` should be reflected by rendered render results or render errors with reasons and evidence. This proves Skillset told the truth about rendering; it does not prove Claude or Codex runtime behavior after activation.

## Lifecycle Dogfooding

Lifecycle dogfooding is not a product command. It is how this repo proves that the change/release workflow is usable:

```bash
skillset change status
skillset change add ...
skillset change check
skillset release plan
skillset release apply --yes
skillset verify
```

The first durable dogfood pass should use a small self-hosted `skillset/` source edit, create a real pending reason, apply release state, refresh generated output, and confirm no drift. A separate fake-repo lifecycle fixture can cover edge cases, but it should not replace using the workflow on the real repo.

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

Eval execution should stay opt-in. Some target eval harnesses require credentials, write benchmark setup files, or touch target runtime configuration. Those workflows are useful, but they are not safe default checks and should not be wired into `skillset check`, `skillset verify`, or repo `bun run check` until a specific mode is proven deterministic, local, credential-free, and side-effect-free.

## Diagnostics

- `skillset test` fails on missing declarations, unsupported source selectors, assertion failure, stale generated output inside the isolated run, malformed test declarations, and unsafe build/write flag combinations.
- Test runs report what they generated, what they asserted, where the retained run lives, and where the refreshed `latest/` output lives.
- Evals should identify whether a result is structural analysis, benchmark output, model behavior, or human review.
- Evals should distinguish read-only analysis from benchmark or runtime modes that write setup files, consume credentials, call providers, or mutate target runtime state.

## Provenance

Test runs record the source selector, target set, run id, generated output paths, assertion results, retained run path, and refreshed latest path in `report.json`, `report.md`, and `latest.json`. Eval runs should use the equivalent `.skillset/build/evals/` boundary if they become a Skillset surface later. This provenance belongs under `.skillset/build/tests/` or `.skillset/build/evals/`, not in ordinary generated target files.

## Evidence

See [Fixtures, Tests, Dogfooding, and Evals](../adrs/drafts/20260609-fixtures-tests-dogfooding-and-evals.md), [Deterministic Projection and Adapter Conformance](../adrs/drafts/20260613-deterministic-projection-and-adapter-conformance.md), the render-results ADR currently filed as [Lowering Outcomes and Loss Ledger](../adrs/drafts/20260614-lowering-outcomes-and-loss-ledger.md), [Build Scopes](build-scopes.md), [Changes](changes.md), and [Releases and Changelogs](releases.md).

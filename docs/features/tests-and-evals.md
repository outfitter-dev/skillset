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
| `skillset test` | `<source-root>/tests.yaml` and `<source-root>/tests/*.yaml` | `implemented` | Deterministic isolated projection and check runner for authored source. |
| `.skillset/evals/` | n/a | `future` | Future adapter-aware behavioral eval declarations or pointers. |

Checked-in internal fixtures use the dedicated layout: `fixtures/<case>/skillset.yaml` as the workspace manifest and `fixtures/<case>/skillset/` as the source root. Inline temp fixtures may still use ordinary `.skillset/skillset.yaml` and `.skillset/src/` trees when they are testing ordinary workspace behavior directly.

## Deterministic Tests

`skillset test` runs isolated deterministic scenarios. It compiles selected source units in a run workspace and checks generated files, provider manifests, and drift without touching live target output.

The implemented v1 shape is selector-driven and source-root owned. Ordinary repos use `.skillset/src/tests.yaml` or `.skillset/src/tests/*.yaml`. Dedicated Skillset repos use `skillset/tests.yaml` or `skillset/tests/*.yaml`. A single `tests.yaml` can hold many named tests; each split file is one test named from the file stem. Test declarations reference existing source units rather than duplicating skills, plugins, agents, or instructions.

```yaml
self-hosted:
  select:
    plugins:
      - skillset
  targets:
    - claude
    - codex
  output:
    kind: isolated
  checks:
    projection: true
    pluginManifests: true
```

Source selection uses source concepts. `select.plugins: true` selects all plugin source families. `select.plugins: ["skillset"]` selects named plugin source families. Object form can narrow plugin selection and plugin-bound skills:

```yaml
plugin-skills:
  select:
    plugins:
      include:
        - skillset
      skills: true
  checks:
    projection: true
```

Skills can be selected directly:

```yaml
primary-skills:
  select:
    skills:
      primary:
        - skillset-codex-development
  checks:
    projection: true
```

`select.skills.plugin` is available for plugin-bound skills, but `select.plugins.skills` is the clearer spelling when the test starts from plugins. `targets` filters provider renderings; `select` filters source units. `--scope` continues to mean generated-destination filtering, not source selection, and `skillset test` rejects build/write flags such as `--scope`, `--yes`, `--dry-run`, `--updated`, `--all`, and `--dist`.

The test runner copies only source-relevant files into an isolated run workspace: ordinary workspaces stage `.skillset/skillset.yaml`, `.skillset/src/`, and `.skillset/changes/`, while dedicated workspaces stage `skillset.yaml`, `skillset/`, and `skillset/changes/`. It then prunes unselected source units before building. It does not stage operational `.skillset/cache/` or `.skillset/snapshots/` contents. If the repo has an existing workspace `skillset.lock`, the test stages that lock too so source-adjacent generated files such as entity `CHANGELOG.md` files remain recognized as managed inside the run.

Generated test output uses the logical cache root in reports and `latest.json`; Skillset stores the physical files in the repo's XDG cache bucket:

```text
.skillset/cache/tests/
  latest/
  latest.json
  runs/<run-id>/
```

Each run writes a complete retained directory under `runs/<run-id>/`, including the isolated workspace and `report.json` / `report.md`. `latest/` is a real refreshed copy of the most recent run, not a symlink, so local marketplaces or generated plugin trees can be inspected with stable paths on platforms where symlinks are fragile. `latest.json` records the active run id, source selection, report path, and generated output path. Retention defaults to keeping prior run directories; pruning is a future option rather than implicit cleanup.

The check vocabulary is deliberately small. `projection: true` means the isolated build succeeds and the selected generated-output diff is clean after the build. `pluginManifests: true` derives enabled provider manifest paths and verifies selected plugin manifest identity, including release-resolved version and shared metadata. File checks remain available through `checks.files` with explicit generated paths:

```yaml
self:
  select:
    skills:
      primary:
        - demo
  checks:
    projection: true
    files:
      - path: .claude/skills/demo/SKILL.md
      - path: .claude/skills/demo/SKILL.md
        contains: Demo body.
```

Target validation commands are reportable manual follow-up instructions in v1; `skillset test` does not install, publish, trust, symlink, or activate Claude/Codex runtime configuration.

Release state and inline versions are observable, not migrated, by deterministic tests. A test may assert the version that build emits after release state is applied, but it must not rewrite source `version` fields or start the SET-43 migration from inline versions to release-state-only authoring.

## Activation Probes

Activation probes are a first layer above deterministic build checks and below evals. They answer “can a target harness notice or invoke the expected skill, agent, or plugin?” They do not judge answer quality, call a model, install a plugin, trust global runtime config, or mutate live build roots.

Source-root test declarations can include lightweight activation probes:

```yaml
activation:
  select:
    skills:
      primary:
        - skillset-repo-test-fixtures
  targets:
    - claude
    - codex
  activation:
    - name: fixture guidance
      prompt: Help me inspect this Skillset fixture setup.
      expect:
        skill: skillset-repo-test-fixtures
  checks:
    projection: true
```

Each probe requires `prompt` and `expect`. The v1 `expect` object must name exactly one of `skill`, `agent`, or `plugin`. Probe `targets` can narrow to enabled test targets; absent probe targets inherit the enclosing test targets. Empty target arrays fail. Before a retained run is written, Skillset verifies that the expected unit was rendered for every selected target in the isolated workspace, so typos and target-disabled units fail without creating partial run directories. Probe assets are generated under the retained test run:

```text
.skillset/cache/tests/runs/<run-id>/activation/<target>/
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

The external lane reuses the pinned repo manifest in `fixtures/external/repos.yaml` and writes reports under the logical `.skillset/cache/fixtures/<name>/` path, backed by the repo's XDG cache bucket. Those reports are conformance evidence for real-world adoption and round-trip fidelity: they show which repo/ref was acquired, what adoption imported, whether lint/build/purity passed, and which generated paths matched or drifted. They are suitable as feature-registry or adapter coverage references, but they remain outside `bun run check`, `skillset:ci`, and PR CI because they may fetch network data and run against large cloned repos.

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
.skillset/cache/evals/
  latest/
  latest.json
  runs/<run-id>/
```

Evals may include prompts, baselines, graders, benchmark workspaces, token measurements, reports, and human review. They should stay distinct from deterministic compile and lifecycle tests.

Eval execution should stay opt-in. Some target eval harnesses require credentials, write benchmark setup files, or touch target runtime configuration. Those workflows are useful, but they are not safe default checks and should not be wired into `skillset check`, `skillset verify`, or repo `bun run check` until a specific mode is proven deterministic, local, credential-free, and side-effect-free.

## Diagnostics

- `skillset test` fails on missing declarations, unsupported source selectors, failed checks, stale generated output inside the isolated run, malformed test declarations, and unsafe build/write flag combinations.
- Test runs report what they generated, what they checked, where the retained run lives, and where the refreshed `latest/` output lives.
- Evals should identify whether a result is structural analysis, benchmark output, model behavior, or human review.
- Evals should distinguish read-only analysis from benchmark or runtime modes that write setup files, consume credentials, call providers, or mutate target runtime state.

## Provenance

Test runs record the source selector, target set, run id, generated output paths, check results, retained run path, and refreshed latest path in `report.json`, `report.md`, and `latest.json`. Eval runs should use the equivalent logical `.skillset/cache/evals/` boundary if they become a Skillset surface later. This provenance belongs under `.skillset/cache/tests/` or `.skillset/cache/evals/` logical cache paths, not in ordinary generated target files.

## Evidence

See [Fixtures, Tests, Dogfooding, and Evals](../adrs/drafts/20260609-fixtures-tests-dogfooding-and-evals.md), [Deterministic Projection and Adapter Conformance](../adrs/drafts/20260613-deterministic-projection-and-adapter-conformance.md), the render-results ADR currently filed as [Lowering Outcomes and Loss Ledger](../adrs/drafts/20260614-lowering-outcomes-and-loss-ledger.md), [Build Scopes](build-scopes.md), [Changes](changes.md), and [Releases and Changelogs](releases.md).

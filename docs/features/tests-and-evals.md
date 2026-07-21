# Tests and Evals

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `activation-probes` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `tests-and-evals`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Skillset implements deterministic source-root test declarations, activation probes, and optional declared or ad hoc runtime tests; evals remain future and adapter-aware. Tests and evals are related because both prove confidence in a Skillset loadout, but they answer different questions. Deterministic tests ask whether selected source projects into expected files and lifecycle state. Evals ask whether a skill, plugin, or agent helps a model do the intended work.

## Current Boundary

Skillset currently uses internal compiler fixtures and validation commands:

| Surface | Location | Status | Purpose |
| --- | --- | --- | --- |
| Internal fixtures | `fixtures/<case>/skillset.yaml` and `fixtures/<case>/.skillset/` ([convention](../../fixtures/README.md)) | `implemented` / internal | Fake repos copied into temp directories by compiler tests. |
| Contract tests | `apps/skillset/src/__tests__/` and `packages/*/src/__tests__/` | `implemented` / internal | Unit, contract, and audit-hardening tests for compiler behavior. |
| Validation commands | `skillset check`, `skillset check --only outputs`, `status`, `diff`, `change check`, `release plan` | `implemented` | Public commands that validate or inspect real source and generated output. |
| Dogfooding | repo scripts, Linear acceptance criteria, real Skillset source changes | internal practice | Proves workflows by using them on this repo. |
| `skillset test` | `<source-root>/tests.yaml` and `<source-root>/tests/*.yaml` | `implemented` | Deterministic isolated projection and check runner for authored source. |
| `skillset test --target …` | `.skillset/cache/tests/ad-hoc/` logical reports backed by XDG cache storage | `implemented` | Runs an ad hoc non-interactive provider test and retains status, output, tail, and report files. |
| `.skillset/evals/` | n/a | `future` | Future adapter-aware behavioral eval declarations or pointers. |

Checked-in internal fixtures use the current workspace layout: `fixtures/<case>/skillset.yaml` as the workspace manifest and `fixtures/<case>/.skillset/` as the source root.

## Deterministic Tests

`skillset test` runs isolated deterministic scenarios. It compiles selected source units in a run workspace and checks generated files, provider manifests, and drift without touching live target output.

The implemented v1 shape is selector-driven and source-root owned. Workspaces use `.skillset/tests.yaml` or `.skillset/tests/*.yaml`. A single `tests.yaml` can hold many named tests; each split file is one test named from the file stem. Test declarations reference existing source units rather than duplicating skills, plugins, agents, or instructions.

```yaml
self-hosted:
  select:
    plugins:
      - skillset
  targets:
    - claude
    - codex
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

Project agents can be selected by their resolved output name:

```yaml
project-agent:
  select:
    agents:
      - reviewer
  checks:
    projection: true
```

`select.skills.plugin` is available for plugin-bound skills, but `select.plugins.skills` is the clearer spelling when the test starts from plugins. `targets` filters provider renderings; `select` filters source units. `--scope` continues to mean generated-destination filtering, not source selection, and `skillset test` rejects build/write flags such as `--scope`, `--yes`, `--updated`, `--all`.

The test runner copies only source-relevant files into an isolated run workspace: root `skillset.yaml`, `.skillset/`, and source-adjacent state such as `.skillset/changes/`. It then prunes unselected source units before building. It does not stage operational `.skillset/cache/` or `.skillset/snapshots/` contents. If the repo has an existing workspace `skillset.lock`, the test stages that lock too so source-adjacent generated files such as entity `CHANGELOG.md` files remain recognized as managed inside the run.

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

Target validation commands are reportable manual follow-up instructions in v1; `skillset test` does not install, publish, trust, symlink, or activate provider runtime configuration.

Release state and inline versions are observable, not migrated, by deterministic tests. A test may assert the version that build emits after release state is applied, but it must not rewrite source `version` fields or start the SET-43 migration from inline versions to release-state-only authoring.

## Activation Probes

Activation probes are a first layer above deterministic build checks and below evals. They answer “can a target harness notice or invoke the expected skill, agent, or plugin?” By default they do not call a model, install a plugin, trust global runtime config, or mutate live build roots. A probe calls a provider only when it includes an explicit `runtime` block.

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

Each probe requires exactly one of `prompt` or `promptFile` plus `expect`. The v1 `expect` object must name exactly one of `skill`, `agent`, or `plugin`. Probe `targets` can narrow to enabled test targets; absent probe targets inherit the enclosing test targets. Empty target arrays fail. Manual probes verify that the expected unit was rendered before a retained run is written. Declared runtime probes report a missing unit as a `render` failure without launching the provider. Probe assets are generated under the retained test run:

```text
.skillset/cache/tests/runs/<run-id>/activation/<target>/
  probes.json
  <probe-name>.md
```

`latest/` receives the same activation directory when the run refreshes. Claude and Cursor probes are rendered as manual native harness prompts. Codex probes are rendered as manual shim-aware prompts because Codex can follow generated loading instructions, but Skillset should not pretend that every Claude-style activation signal is target-enforced in Codex. Future Codex plugin-eval integration can consume the same `probes.json` shape once that runner boundary is proven.

Edge cases stay explicit: multiple matching skills should be disambiguated in the expected selector, provider source may need target-specific probes, missing plugin dependencies should appear as activation setup failures rather than build successes, and compatibility shims should be reported as shims in the generated probe material.

### Declared Runtime Tests

An activation probe becomes a committed live-runtime test when it includes `runtime`. The enclosing `skillset test` declaration still performs its deterministic checks first; only then does Skillset invoke each selected target through the same isolated runner used by ad hoc `skillset test`.

```yaml
select:
  skills:
    primary: [docs-cli]
targets: [claude, codex]
activation:
  - name: docs activation
    targets: [claude]
    promptFile: prompts/docs-activation.md
    expect:
      skill: docs-cli
    runtime:
      claude:
        settingSources: isolated
      timeoutMs: 30000
      expect:
        contains: docs-cli
        notContains: missing skill
  - name: codex docs activation
    targets: [codex]
    prompt: Which documentation skill is available?
    expect:
      skill: docs-cli
    runtime:
      expect:
        contains: docs-cli
checks:
  projection: true
```

`prompt` and `promptFile` are mutually exclusive. Prompt files resolve inside the active Skillset source root, so committed declarations remain portable. Probe `targets` select the provider invocations; the expected `skill`, `agent`, or `plugin` must be present in the isolated rendering before Skillset launches a runtime. `runtime.expect` supports literal `contains` and `notContains` assertions. This deliberately small vocabulary proves a repeatable fact without introducing model graders, scores, comparisons, or repeated trials.

Run the declaration through the normal command:

```bash
skillset test docs-activation
```

The command remains credential-free when the selected declaration has no `runtime` block. Live declarations use provider credentials and binaries already available to the process; they do not install, trust, publish, or edit user-level provider configuration. Claude defaults to isolated setting sources and can explicitly select `isolated`, `user`, `project`, or `local` for a declared probe.

Runtime results distinguish `render`, `binary`, `setup`, `auth`, `timeout`, `runtime`, and `assertion` failures. A provider process can therefore complete successfully while its declared expectation fails as `assertion`; missing generated units fail as `render` before provider launch, while a missing executable fails as `binary`. JSON and Markdown test reports record the target, command context, prompt provenance, normalized assertion results, and logical raw evidence paths. Raw ad hoc reports, stdout/stderr events, prompts, and final responses remain under the repo's XDG-backed `.skillset/cache/tests/ad-hoc/` bucket.

The promotion path is intentionally direct: use `skillset test` to refine a provider prompt, move the prompt inline or into a source-root file, add the expected rendered unit and literal response assertion to an activation probe, then run it with `skillset test`. Subjective quality evaluation remains separate work under SET-51.

## Ad Hoc Runtime Tests

The same `skillset test` family owns ad hoc live-runtime probes. A named test runs a committed declaration; `--target` plus exactly one prompt input starts an ad hoc provider process. Ad hoc success means the provider process completed. Committed runtime blocks retain their stronger declared assertion contract.

```bash
skillset test --target codex --prompt "What skills can you see?"
skillset test --target claude --prompt-file prompts/smoke.md --claude-setting-sources isolated --background
skillset test status
skillset test tail --lines 80
skillset test list
```

Runs write retained artifacts under the logical repo cache path:

```text
.skillset/cache/tests/ad-hoc/
  latest.json
  runs/<run-id>/
    config.json
    prompt.md
    status.json
    output.jsonl
    stdout.txt
    stderr.txt
    final-message.txt
    report.json
```

The physical files live in the repo's XDG-backed Skillset cache bucket. Reports keep logical `.skillset/cache/...` paths so humans, issue comments, and future eval tooling can refer to stable locations without depending on a machine-specific cache root.

`status` reports `queued`, `building`, `running`, `passed`, or `failed`; `tail` streams retained JSONL output; and `list` shows recent ad hoc runs. Those lifecycle words are reserved and cannot be declaration names. `--background` starts a worker and returns as soon as the queued run is recorded.

The tester does not install, trust, publish, or enable generated artifacts. It invokes local runtimes against the isolated `latest` rendering. Claude probes default to `--claude-setting-sources isolated`, which passes an explicit empty Claude `--setting-sources` list and loads generated plugins with `--plugin-dir`, so env auth and the rendered plugin directories are the only intended Claude inputs.

Claude setting sources can be overridden for probes that intentionally need more runtime context. Precedence is CLI flag, then env var, then the isolated default:

```bash
skillset test --target claude --claude-setting-sources user --prompt "What do you see?"
SKILLSET_TEST_CLAUDE_SETTING_SOURCES=project skillset test --target claude --prompt "What do you see?"
```

Override runtime binaries with `SKILLSET_TEST_CODEX_BIN`, `SKILLSET_TEST_CLAUDE_BIN`, or `SKILLSET_TEST_CURSOR_BIN` for tests, shims, or machine-specific installs.

For Claude Code non-interactive runs, the CLI process must see a non-interactive credential. If `claude --print` reports `Not logged in`, run `claude setup-token`, put the printed `CLAUDE_CODE_OAUTH_TOKEN` export in the repo-local ignored `.envrc`, and run `direnv allow`. The committed `.envrc.example` shows the expected shape without storing secrets. From shells or automation that do not load the direnv hook, use `direnv exec . skillset test ...`.

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

The external lane reuses the pinned repo manifest in `fixtures/external/repos.yaml` and writes reports under the logical `.skillset/cache/fixtures/<name>/` path, backed by the repo's XDG cache bucket. Those reports are conformance evidence for real-world adoption and round-trip fidelity: they show which repo/ref was acquired, what adoption imported, whether lint/build/purity passed, and which generated paths matched or drifted. They are suitable as feature-registry or adapter coverage references, but they remain outside `bun run check`, `skillset:check:ci`, and PR CI because they may fetch network data and run against large cloned repos.

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
skillset check --only outputs
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

Eval execution should stay opt-in. Some target eval harnesses require credentials, write benchmark setup files, or touch target runtime configuration. Those workflows are useful, but they are not safe default checks and should not be wired into `skillset check`, `skillset check --only outputs`, or repo `bun run check` until a specific mode is proven deterministic, local, credential-free, and side-effect-free.

## Diagnostics

- `skillset test` fails on missing declarations, unsupported source selectors, failed checks, stale generated output inside the isolated run, malformed test declarations, and unsafe build/write flag combinations.
- Test runs report what they generated, what they checked, where the retained run lives, and where the refreshed `latest/` output lives.
- Evals should identify whether a result is structural analysis, benchmark output, model behavior, or human review.
- Evals should distinguish read-only analysis from benchmark or runtime modes that write setup files, consume credentials, call providers, or mutate target runtime state.

## Provenance

Test runs record the source selector, target set, run id, generated output paths, check results, retained run path, and refreshed latest path in `report.json`, `report.md`, and `latest.json`. Eval runs should use the equivalent logical `.skillset/cache/evals/` boundary if they become a Skillset surface later. This provenance belongs under `.skillset/cache/tests/` or `.skillset/cache/evals/` logical cache paths, not in ordinary generated target files.

## Evidence

See [Fixtures, Tests, Dogfooding, and Evals](../adrs/0012-fixtures-tests-dogfooding-and-evals.md), [Deterministic Projection and Adapter Conformance](../adrs/0019-deterministic-projection-and-adapter-conformance.md), [Render Results](../adrs/0018-render-results.md), the superseded [Lowering Outcomes and Loss Ledger](../adrs/0017-lowering-outcomes-and-loss-ledger.md), [Build Scopes](build-scopes.md), [Changes](changes.md), and [Releases and Changelogs](releases.md).

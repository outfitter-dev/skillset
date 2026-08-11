---
description: Skillset tests and evals define deterministic checks, activation probes, runtime trials, reports, and retention.
---

# Tests and Evals

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `activation-probes` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Skillset implements deterministic [source-root](../../glossary.md#source-root) test declarations, [activation](../../glossary.md#activation) probes, optional declared or ad hoc runtime tests, portable skill-local eval declarations, and opt-in ungraded eval runs. Tests and evals are related because both establish confidence in a Skillset [loadout](../../glossary.md#loadout), but they answer different questions. Deterministic tests ask whether selected source [projects](../../glossary.md#projection) into expected files and lifecycle state. Evals retain provider trial evidence without judging whether a model met an expectation.

## Choose the Evidence You Need

| Question | Surface | Runtime process | Result |
| --- | --- | --- | --- |
| Does selected source [render](../../glossary.md#render) deterministically and satisfy declared checks? | `skillset test` declaration | Only for an explicit declared runtime section | Isolated projection and structured checks |
| Did a declared capability actually run for the current source? | Activation probe or declared runtime claim | Yes | Current bounded proof receipt |
| What does one local provider do with this prompt? | `skillset test --target … --prompt …` | Yes | Retained ad hoc runtime evidence |
| What happens for every declared case and enabled [target](../../glossary.md#target)? | `skillset eval run` | Yes | Ungraded case-by-target trial evidence |

Use `skillset check` and `check --only outputs` for ordinary source and [generated-output](../../glossary.md#generated-output) readiness. They do not replace declared tests or launch providers.

## Deterministic Tests

`skillset test` runs isolated deterministic scenarios. It compiles selected [source units](../../glossary.md#source-unit) in a run [workspace](../../glossary.md#workspace) and checks generated files, provider manifests, and [drift](../../glossary.md#drift) without touching live target output.

Core owns declaration loading, source selection, caller-supplied workspace materialization, deterministic checks, rendered activation facts, and literal runtime assertions through an injected runtime probe. The CLI app owns temporary and retained-run lifecycle, report/Markdown rendering, runtime process execution and evidence, JSON/JSONL/terminal behavior, and status/tail/worker policy. This preserves one compiler-owned evaluation contract without giving Core a cache, process, or CLI policy surface.

The implemented declaration shape is selector-driven and source-root owned. Workspaces use `.skillset/tests.yaml` or `.skillset/tests/*.yaml`. A single `tests.yaml` can hold many named tests; each split file is one test named from the file stem. Test declarations reference existing source units rather than duplicating skills, plugins, agents, or instructions.

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

`select.skills.plugin` is available for plugin-bound skills, but `select.plugins.skills` is the clearer spelling when the test starts from plugins. `targets` filters provider renderings; `select` filters source units. `--scope` continues to mean generated [destination](../../glossary.md#destination) filtering, not source selection, and `skillset test` rejects build/write flags such as `--scope`, `--yes`, `--updated`, `--all`.

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

Target validation commands are reportable manual follow-up instructions; `skillset test` does not install, publish, trust, symlink, or activate provider runtime configuration.

Release state and inline versions are observable, not migrated, by deterministic tests. A test may assert the version that build emits after release state is applied, but it must not rewrite source `version` fields or migrate version authority. The [Releases reference](releases.md) owns that boundary.

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

Each probe requires exactly one of `prompt` or `promptFile` plus `expect`. The `expect` object must name exactly one of `skill`, `agent`, or `plugin`. Probe `targets` can narrow to enabled test targets; absent probe targets inherit the enclosing test targets. Empty target arrays fail. Manual probes verify that the expected unit was rendered before a retained run is written. Declared runtime probes report a missing unit as a `render` failure without launching the provider. Probe assets are generated under the retained test run:

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
      claims:
        - capability: mcp-server
          subject: docs
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

An optional `runtime.claims` array can bind a passing declaration to current
activation readiness. Each claim names only a canonical `capability` and
`subject`; authors never copy internal requirement IDs. Core resolves the claim
for every selected target and source projection before provider execution.
Unknown, ambiguous, disabled, or unsupported claims fail before the runtime is
launched. A passing current receipt satisfies only the resolved `proven`
requirements it names. Failed, cancelled, timed-out, stale, and successful but
unclaimed runs prove nothing. Retained proof is bound to the current authored
declaration: deleting it or changing its prompt, runtime expectations, claims,
or selection makes the prior result stale. The selected rendered source
projection is part of the receipt identity, so changing a selected source unit
makes prior proof stale while unrelated unselected units do not.

Structured runtime evidence currently corroborates only `mcp-server` claims.
The `app` and `plugin-dependency` capability names remain valid in the shared
activation schema, but `runtime.claims` rejects them before provider launch
until a bounded structured adapter can establish their use.

Run the declaration through the normal command:

```bash
skillset test docs-activation
```

The command remains credential-free when the selected declaration has no `runtime` block. Live declarations use provider credentials and binaries already available to the process; they do not install, trust, publish, or edit user-level provider configuration. Claude defaults to isolated setting sources and can explicitly select `isolated`, `user`, `project`, or `local` for a declared probe.

Runtime results distinguish `render`, `binary`, `setup`, `auth`, `timeout`, `cancelled`, `runtime`, and `assertion` failures. A provider process can therefore complete successfully while its declared expectation fails as `assertion`; missing generated units fail as `render` before provider launch, while a missing executable fails as `binary`. JSON and Markdown test reports record the target, command context, prompt provenance, normalized assertion results, and logical raw evidence paths. Raw ad hoc reports, stdout/stderr events, prompts, and final responses remain under the repo's XDG-backed `.skillset/cache/tests/ad-hoc/` bucket.

The promotion path is intentionally direct: use `skillset test` to refine a provider prompt, move the prompt inline or into a source-root file, add the expected rendered unit and literal response assertion to an activation probe, then run it with `skillset test`. Subjective quality evaluation remains outside the deterministic assertion contract; eval runs retain evidence without assigning a model-quality verdict.

## Ad Hoc Runtime Tests

The same `skillset test` family owns ad hoc live-runtime probes. A named test runs a committed declaration; `--target` plus exactly one prompt input starts an ad hoc provider process. Ad hoc success means the provider process completed. Committed runtime blocks retain their stronger declared assertion contract.

Ad hoc runs are transport evidence only. They have no authored claim context
and therefore cannot mint activation proof receipts, even when the provider
process exits successfully.

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

## Evals

Each skill can own one portable declaration at `evals/evals.json`, relative to
its `SKILL.md`. The base shape intentionally follows Anthropic's
`skill-creator` convention: `skill_name`, `evals`, and each case's integer
`id`, `prompt`, `expected_output`, optional `files`, and optional
`expectations`. Existing skill-creator-compatible files therefore remain
valid without rewrites. This is compatibility with that concrete file shape,
not a claim that Agent Skills defines a formal cross-provider eval standard.

```json
{
  "skill_name": "docs-cli",
  "evals": [
    {
      "id": 1,
      "prompt": "Summarize evals/files/brief.txt.",
      "expected_output": "A concise summary of the brief.",
      "files": ["evals/files/brief.txt"],
      "expectations": ["The response names the brief title."],
      "skillset": {
        "targets": ["codex"]
      }
    }
  ]
}
```

The portable fields stay top-level so the file remains readable by
`skill-creator`. Skillset-only behavior is namespaced under a case-local
`skillset` object. Its only current key is `targets`, which narrows that case
to targets already enabled for the owning skill. Without it, the case derives
every target enabled for that skill in the build graph. Unknown fields,
duplicate IDs, missing skill-root-relative files, and impossible target
selections fail validation.

Eval cases are deliberately ungraded. `expected_output` and `expectations` are
retained as reviewer context, but a completed provider process, nonzero tool
call count, or superficially related response cannot prove that a named
capability was exercised. Evals therefore cannot declare activation claims and
their reports never mint activation proof receipts.

Use the read-only command to inspect that derived matrix:

```bash
skillset eval list
skillset eval list --json
```

`skillset eval list` validates source and derives rows; it never invokes a
provider, grades output, creates a baseline, or writes a workspace. `skillset
new skill <name> --preset evals` scaffolds a valid empty document with the
matching `skill_name`.

### Portable Source and Machine-Local Execution

The declaration above is portable authored source. Provider runs, benchmark
workspaces, token measurements, and trial reports are machine-local evaluation
concerns. `skillset eval run` is the opt-in execution boundary: it derives the
same deterministic case-by-target matrix as `eval list`, stages each case's
declared files at its authored relative path in an isolated trial workspace,
and invokes the target-native local adapter. A completed provider trial is not
a quality verdict: `expected_output` and `expectations` are retained as
authored context only. Skillset does not grade, compare, score, baseline, or
otherwise pass a model response against them.

```bash
skillset eval run
skillset eval run --timeout-ms 30000
skillset eval status [run-id]
skillset eval tail [run-id] --lines 80
```

Each run retains an isolated source/rendering workspace, prompt, provider
event stream, final message when the adapter supplies one, stdout/stderr,
and structured trial report. Reports preserve the standalone or plugin owner,
case id, target, authored expectations, command, duration, model/token/tool
usage when the provider supplies it, and the explicit outcome classification.
`non_lowering` means the declared skill was not emitted for a selected target;
`unavailable` means staged input or a local provider activation path could not
be prepared. In particular, plugin-owned Codex trials remain unavailable until
the Codex adapter can activate a local generated plugin bundle.
`infrastructure_failure` distinguishes adapter/auth/binary/setup/runtime/timeout/cancel
outcomes from a completed trial. A run that completes its infrastructure work
has lifecycle state `completed`; this is not a quality judgment. Eval data contains no
per-run or per-trial verdict boolean: CLI exit code describes only
execution/infrastructure state, never whether a model response met an authored
expectation.

Generated eval evidence lives under the logical cache root:

```text
.skillset/cache/evals/
  latest/
  latest.json
  runs/<run-id>/
```

Baselines, graders, comparisons, benchmark summaries, and human review remain
future machine-local concerns. They stay distinct from deterministic compile
and lifecycle tests.

Eval execution stays opt-in. It may require credentials and provider binaries,
so it is never wired into `skillset check`, `skillset check --only outputs`,
repo `bun run check`, or CI. Foreground cancellation is retained as a distinct
cancelled infrastructure outcome; a durable background cancellation protocol
is intentionally outside this slice.

## Diagnostics

- `skillset test` fails on missing declarations, unsupported source selectors, failed checks, stale generated output inside the isolated run, malformed test declarations, and unsafe build/write flag combinations.
- Test runs report what they generated, what they checked, where the retained run lives, and where the refreshed `latest/` output lives.
- `skillset eval run` reports read-only source analysis separately from provider
  execution and retains explicit `non_lowering`, `unavailable`, and
  `infrastructure_failure` classifications without inferring model quality.

## Provenance

Test runs record the source selector, target set, run id, generated output paths, check results, retained run path, and refreshed latest path in `report.json`, `report.md`, and `latest.json`. Eval runs use the equivalent logical `.skillset/cache/evals/` boundary and preserve owner, case, target, staged workspace, prompts, events, provider output, and ungraded authored context in `report.json`. This provenance belongs under `.skillset/cache/tests/` or `.skillset/cache/evals/` logical cache paths, not in ordinary generated target files.

## Evidence

See [Fixtures, Tests, Dogfooding, and Evals](../../adrs/0012-fixtures-tests-dogfooding-and-evals.md), [Deterministic Projection and Adapter Conformance](../../adrs/0019-deterministic-projection-and-adapter-conformance.md), [Render Results](../../adrs/0018-render-results.md), [Build Scopes](build-scopes.md), and [Runtime Activation Readiness](runtime-activation-readiness.md). Maintainer-only conformance and repository dogfooding belong in the [development reference](../../development/README.md).

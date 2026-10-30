# Internal Fixtures

`fixtures/` holds maintainer-owned fake content repos used by the compiler's tests. They are internal test material, not product source and not a `.skillset/tests/` contract. See [Fixtures, Tests, Dogfooding, and Evals](../docs/adrs/0012-fixtures-tests-dogfooding-and-evals.md) and [Tests and Evals](../docs/reference/features/tests-and-evals.md) for the surrounding boundary.

`fixtures/` is never scanned as this repo's own Skillset source.

## Absolute acceptance claims

When a new or changed acceptance claim says **exact**, **complete**, **required**, **blocked**, **corrupt**, **idempotent**, or **Bun-free**, include at least one counterexample test that fails if the nearby wrong state is accepted. Choose a plausible regression in the behavior being changed and make the assertion distinguish it from the promised result. A passing happy-path fixture alone cannot support an absolute claim.

For an exact file inventory, compare the complete set so an extra file fails. For a corrupt executable, keep the file present with invalid contents; deleting it proves only the missing-file case. For idempotence, repeat the operation and compare the promised state. For Bun-free execution, exercise the child process with Bun unavailable rather than inferring independence from package metadata.

Use this checklist when designing tests and reviewing their evidence:

- What extra input could be incorrectly accepted?
- What required input could be missing?
- What wrong identity could masquerade as the right one?
- What partial or recovery state differs structurally from the happy path, such as an existing release with zero assets?
- Does the fixture prove the named state, or only a neighboring failure?
- Does an executable documentation example compile or run against the real public API?

Prefer the smallest fixture and assertion that distinguish the counterexample. Record the relevant negative case with the verification evidence; do not introduce a new test framework or cover hypothetical states unrelated to the change. This is a forward-looking convention: apply it to new claims and when the affected tests are next touched, without retrofitting the entire suite.

## Three tiers of fixture

Tests build fake repos at three tiers. Pick the lighter one unless a case earns the heavier one.

### In-test temp fixtures (default)

Most coverage builds a small `.skillset/` tree inline and writes it to a temp directory per test. A tiny builder takes a `Record<path, content>` map:

- `fixture(...)` — defined locally in `src/__tests__/skillset.test.ts`
- `contractFixture(...)` — shared by the CLI contract suites (`contract.test.ts`, `contract-release.test.ts`, `contract-reconcile.test.ts`) and exported from `src/__tests__/contract-test-helpers.ts` with the suites' other Git, change-stream, and CLI helpers
- `fixture(...)` — defined locally in `src/__tests__/audit-hardening.test.ts`

Use this for focused positive cases, negative/diagnostic cases, and change/release lifecycle scenarios. The fixture content lives next to the assertion that depends on it, so the test reads top to bottom. This is the common case by a wide margin and should stay inline — the maps are small and each is semantically distinct, so centralizing them would not meaningfully reduce volume.

Git-backed fixtures must be created through `scripts/test-helpers/git-remote.ts`. The test runner supplies empty sandbox-owned global and system Git config files and disables terminal prompts while preserving `HOME`; the helper additionally strips command-line config injection before every Git subprocess. This boundary matters because repository-local operations can otherwise inherit signing, hooks, templates, credentials, includes, excludes, attributes, default-branch policy, or identity from a maintainer's machine.

Use `createTestGitFixtureRoot()` for the owned parent, create a fresh child directory beneath it, then call `initializeTestGitRepository()` or `createTestGitRemote()` with that parent as `disposableRoot`. The helper refuses the Skillset checkout, symlinks, existing repositories, bare repositories, linked worktrees, shared Git common directories, and unrelated temp directories before running `git init` or writing deterministic fixture-only identity.

### Checked-in fixtures (`fixtures/<case>/`)

A checked-in fixture is a durable fake content repo committed to the tree. Tests copy `fixtures/<case>` into a temp directory and run the compiler against it with `--root <temp>`. Reach for one only when a fixture:

- must be inspected as a whole realistic repo, not just as inline literals;
- is shared by many tests as a golden reference; or
- is too large to keep readable inline.

Current checked-in cases:

- [`kitchen-sink/`](kitchen-sink/README.md) is the complete-surface positive build fixture.
- [`authoring-model/`](authoring-model/README.md) is the current source-layout acceptance fixture; later issues activate its documented future cases.
- [`adaptive-hooks/`](adaptive-hooks/README.md) is the positive authoring fixture for adaptive hook recipes.
- [`cursor-parity/`](cursor-parity/README.md) is the evidence baseline for pinned Cursor paths and named parity gaps.
- [`workbench-clean/`](workbench-clean/README.md) is a small positive Workbench source-contract fixture.
- [`workbench-invalid/`](workbench-invalid/README.md) is a small negative Workbench fixture for deterministic source, resource, and runtime diagnostics.

### External fixture repos (`fixtures/external/`)

External fixtures are real published repos that Skillset should be able to adopt: `init` detects their import candidates, `import` lifts them into `.skillset/` source, `lint` and `build` succeed, and each requested target projection is compared with the original. They are maintainer test material like the other tiers, but they track living upstreams instead of frozen fakes.

- `fixtures/external/repos.yaml` is the committed manifest. Each entry pins a repo to a full commit SHA and may set `targets:` (default `claude`) and `notes:`.
- `fixtures/external/repos/<name>/` holds gitignored clones at the pinned SHA. They are never scanned as this repo's own source.
- Runs execute in throwaway temp workspaces and write `report.md` / `report.json` under `.skillset/cache/fixtures/<name>/`.

```bash
bun scripts/fixtures/external.ts sync     # clone/fetch every entry at its pinned SHA
bun scripts/fixtures/external.ts update   # re-pin entries to upstream HEAD, then sync
bun scripts/fixtures/external.ts run      # adopt, compile, and produce round-trip reports
bun run conformance:external              # named slow-lane wrapper for run
```

Each verb accepts an optional entry name to target one repo. A run fails (non-zero exit) when init, import, lint, or build fails; the round-trip comparison is report-only for now and exists to make fidelity gaps visible, not to gate. Runs are local/manual — they touch the network, so they are not part of `bun run check` or PR CI. `bun run conformance:external -- <name>` is the preferred named slow-lane entrypoint when collecting evidence for one pinned repo. Synced clones carry their own test suites, so repo tests run from tracked test files via `bun run test`; a bare `bun test` would scan the clones too. Gaps surfaced by a run should become ordinary product fixes with inline regression fixtures, not edits to the external repo clones.

## Transform and conformance evidence

Follow the [transform review contract](../CONTRIBUTING.md#review-transform-recognition-and-output-together). A reversible rewrite or a successful build does not prove provider equivalence. Keep a supported semantic example and a nearby negative corpus together: handles, CSS at-rules, decorators, package scopes, fences, inline literals, mixed-provider filenames, cache paths and marketplace paths where relevant. Assert preserved bytes and the absence of unintended dialect declaration or transformation for ambiguous inputs.

Test the public recognition and transformation boundaries, including declared directions and exception validation. A synthetic intent protocol proves engine mechanics only; real mappings also need current source and destination contract evidence at the recognizer's full breadth. A reversible provider-prefix mutation that invents a plausible destination is a useful negative control. Coverage lists must require deliberate cases for new built-ins, but neither a list nor evidence metadata proves semantic correctness.

For external adoption comparisons, pin the original tree, preserve it unchanged, and record the exact source revision, input cohort, emitted bytes, fidelity changes and uninspected surfaces. Classify confirmed defects, intended normalizations and unresolved evidence separately. Convert proven failures to focused regressions; do not weaken the corpus or edit the originals to obtain parity. Deterministic output, provider-contract conformance and runtime effectiveness are separate claims.

## Layout convention

A checked-in case looks like a realistic content repo:

```text
fixtures/<case>/
  skillset.yaml
  .skillset/
    .gitignore
    plugins/
    skills/
    RULES.md
    rules/
    subagents/
    hooks/
    shared/
    _claude/   # optional provider source
    _codex/    # optional provider source
    changes/
      .gitkeep
    snapshots/.gitignore
  ...other repo files as needed
```

Checked-in cases use the current workspace layout: root `skillset.yaml` is the workspace manifest, and `.skillset/` is the adaptive source root. `.skillset/cache/` is rebuildable operational output backed by XDG storage and stays ignored rather than checked in; `.skillset/snapshots/` is local recovery output with a tracked ignore sentinel. Plugins, standalone skills, rules, project subagents, shared resources, hooks, and provider source all live under the source root. Provider-specific source uses underscore-prefixed directories such as `.skillset/_claude`, `.skillset/_codex`, `.skillset/_cursor`, `.skillset/plugins/<plugin>/_claude`, `.skillset/plugins/<plugin>/_codex`, and `.skillset/plugins/<plugin>/_cursor`.

Inline temp fixtures should use root `skillset.yaml` plus `.skillset/` unless a test is specifically covering a retired-layout rejection or migration helper.

## kitchen-sink scope

`kitchen-sink/` is the complete-surface **positive** golden reference: one build that exercises plugins, skills, rules, shared resources, hooks, and Claude/Codex companions. It stays broad and is not split.

It intentionally does not cover negative cases, feature isolation, project agents, provider source, or change/release lifecycle. Those live as in-test temp fixtures in `src/__tests__/`. If a future scenario needs a durable, inspectable fake repo (for example a lifecycle-specific case), add a new `fixtures/<case>/` rather than overloading kitchen-sink.

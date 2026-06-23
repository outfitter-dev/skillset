# Internal Fixtures

`fixtures/` holds maintainer-owned fake content repos used by the compiler's tests. They are internal test material, not product source and not a `.skillset/tests/` contract. See [Fixtures, Tests, Dogfooding, and Evals](../docs/adrs/drafts/20260609-fixtures-tests-dogfooding-and-evals.md) and [Tests and Evals](../docs/features/tests-and-evals.md) for the surrounding boundary.

`fixtures/` is never scanned as this repo's own Skillset source.

## Three tiers of fixture

Tests build fake repos at three tiers. Pick the lighter one unless a case earns the heavier one.

### In-test temp fixtures (default)

Most coverage builds a small `.skillset/` tree inline and writes it to a temp directory per test. Each test file defines a tiny builder that takes a `Record<path, content>` map:

- `fixture(...)` — `src/__tests__/skillset.test.ts`
- `contractFixture(...)` — `src/__tests__/contract.test.ts`
- `fixture(...)` — `src/__tests__/audit-hardening.test.ts`

Use this for focused positive cases, negative/diagnostic cases, and change/release lifecycle scenarios. The fixture content lives next to the assertion that depends on it, so the test reads top to bottom. This is the common case by a wide margin and should stay inline — the maps are small and each is semantically distinct, so centralizing them would not meaningfully reduce volume.

### Checked-in fixtures (`fixtures/<case>/`)

A checked-in fixture is a durable fake content repo committed to the tree. Tests copy `fixtures/<case>` into a temp directory and run the compiler against it with `--root <temp>`. Reach for one only when a fixture:

- must be inspected as a whole realistic repo, not just as inline literals;
- is shared by many tests as a golden reference; or
- is too large to keep readable inline.

Current checked-in cases:

- [`kitchen-sink/`](kitchen-sink/README.md) is the complete-surface positive build fixture.
- [`workbench-clean/`](workbench-clean/README.md) is a small positive Workbench source-contract fixture.
- [`workbench-invalid/`](workbench-invalid/README.md) is a small negative Workbench fixture for deterministic source, resource, and runtime diagnostics.

### External fixture repos (`fixtures/external/`)

External fixtures are real published repos that Skillset should be able to adopt: `init` detects their import candidates, `import` lifts them into `.skillset/` source, `lint` and `build` succeed, and the generated Claude projection comes out substantially similar to the original. They are maintainer test material like the other tiers, but they track living upstreams instead of frozen fakes.

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

## Layout convention

A checked-in case looks like a realistic content repo:

```text
fixtures/<case>/
  skillset.yaml
  skillset/
    plugins/
    skills/
    rules/
    hooks/
    shared/
    _claude/   # optional provider source
    _codex/    # optional provider source
  ...other repo files as needed
```

Checked-in cases use the dedicated Skillset repo layout: root `skillset.yaml` is the workspace manifest, and root `skillset/` is the adaptive source root. This keeps durable fixtures aligned with this repo's self-hosted layout and reserves `.skillset/` inside fixtures for ignored build/test output. Plugins, standalone skills, instructions, project agents, shared resources, hooks, and provider source all live under the source root. Provider-specific source uses underscore-prefixed directories such as `skillset/_claude`, `skillset/_codex`, `skillset/plugins/<plugin>/_claude`, and `skillset/plugins/<plugin>/_codex`.

Inline temp fixtures may still use the ordinary `.skillset/skillset.yaml` and `.skillset/src/` shape when a test is specifically covering ordinary workspace behavior. The checked-in fixture default is dedicated layout so the fixture inventory does not look like this repo's generated `.skillset/` scratch area.

## kitchen-sink scope

`kitchen-sink/` is the complete-surface **positive** golden reference: one build that exercises plugins, skills, instructions, shared resources, hooks, and Claude/Codex companions. It stays broad and is not split.

It intentionally does not cover negative cases, feature isolation, project agents, provider source, or change/release lifecycle. Those live as in-test temp fixtures in `src/__tests__/`. If a future scenario needs a durable, inspectable fake repo (for example a lifecycle-specific case), add a new `fixtures/<case>/` rather than overloading kitchen-sink.

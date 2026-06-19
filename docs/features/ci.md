# CI

Feature id: `ci`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

`skillset ci` is the continuous-integration entrypoint: one command that runs source lint, change-entry coverage, and generated-output drift detection, separates mechanical problems from problems that need authored source changes, and renders a Markdown report for pull-request comments and job summaries. It composes the same primitives as `skillset lint`, `skillset change check`, and `skillset diff`/`skillset build`, so a local run reproduces exactly what the workflow runs.

## Authoring

```bash
skillset ci                                 # read-only: lint + change check + drift, exit 1 on problems
skillset ci --fix                           # additionally rebuild stale generated output (like build --yes)
skillset ci --since origin/main             # change-entry baseline override
skillset ci --report skillset-ci-report.md  # write the Markdown report for PR comments / job summaries
skillset init --include ci --yes            # scaffold .github/workflows/skillset-ci.yml
```

This repo's `bun run check` remains the default local and hosted CI aggregate. It runs the tracked test corpus, which includes the fast deterministic projection and adapter conformance suites. Use `bun run conformance:fast` only when you want a focused rerun of those suites without the rest of the tests. `bun run conformance:external` remains an opt-in slower lane and must not be folded into `bun run check` or scaffolded CI while it needs network access or large cloned repos.

Generated-output drift is the only mechanical problem: with `--fix`, `ci` rebuilds generated output the same way `skillset build --yes` would and reports which files it rewrote. Lint issues, missing or invalid change entries, unresolved change baselines, and build errors need authored source or CI changes, so they always stay report-only and fail the run. `--fix` is skipped when those non-mechanical problems are present, so a rebuild never launders uncovered or invalid source into committed output.

Generated entity `CHANGELOG.md` files are managed projections, but CI should not make hand edits to them feel like a dead end. When stale generated output includes a changelog, the report explains that pre-release wording belongs in `skillset change reason <@ref>` and released-history corrections belong in `skillset change amend <@ref>` or the planned release-amend workflow. `--fix` can still restore the generated projection from source, but it does not treat the generated changelog edit as source truth.

[Source Suggestions](source-suggestions.md) is the future recovery path for managed generated-output edits that should become source changes. CI writeback remains future-only until the local suggestion command can classify clean source patches, refusal cases, and stale lock/conflict risks.

`skillset init --include ci` (and `skillset create --include ci`) scaffolds `.github/workflows/skillset-ci.yml`. The workflow is user-owned after creation: rerunning `init --include ci` reports an edited workflow as existing and never overwrites it. The scaffolded workflow:

- runs `skillset ci --fix` on same-repo pull requests and plain `skillset ci` on fork pull requests or pushes to `main`;
- appends the Markdown report to the job summary on every run;
- commits and pushes mechanical rebuilds back to same-repo pull-request branches;
- posts (or updates) the report as a PR comment when non-mechanical problems remain, then fails the check.

Fork pull requests cannot receive pushes or comments with the default `GITHUB_TOKEN`, so the scaffold keeps them read-only; they still get the failing check and the job-summary report.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `skillset ci` command | n/a | n/a | `implemented` | Workflow tooling, not a rendered source feature. |
| `--include ci` workflow scaffold | n/a | n/a | `implemented` | Writes `.github/workflows/skillset-ci.yml` once; user-owned afterwards. |

## Diagnostics

The report separates four sections: stale generated output (mechanical; fixed by `--fix` or `skillset build --yes`), lint issues, change-entry errors and warnings (fix with `skillset change add`), and build errors. A change-check infrastructure failure (for example no resolvable baseline in a shallow clone) is reported distinctly so CI configuration problems are not mistaken for missing entries; the scaffolded workflow checks out with `fetch-depth: 0` to keep `origin/main` resolvable.

Exit status is non-zero whenever a non-mechanical problem remains, or when drift remains and `--fix` was not passed. With `--fix`, a run whose only problem was drift exits zero after rebuilding, which lets the workflow commit the rebuild instead of failing.

The Markdown report starts with the `<!-- skillset-ci-report -->` marker so workflows can find and update an existing comment instead of stacking new ones.

## Provenance

`skillset ci` creates no source truth and never publishes, installs, or mutates user or runtime config. Its only writes are the generated outputs a `--fix` rebuild produces (identical to `skillset build --yes`) and the report file passed to `--report`. The scaffolded workflow is plan-listed by `init`/`create` like every other setup file and is written only with `--yes`.

## Evidence

See `src/ci.ts`, `src/__tests__/ci.test.ts`, and this repo's own [.github/workflows/ci.yml](../../.github/workflows/ci.yml), which dogfoods the scaffolded workflow shape against the local compiler.

# CI

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `workflows` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `ci`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

`skillset check --ci` is the continuous-integration mode of the cohesive readiness command. It adds branch-aware change coverage and package Changesets awareness to the same source diagnostics and generated-output drift detection used by local `skillset check`, and it can render a Markdown report for pull-request comments and job summaries.

## Authoring

```bash
skillset check --ci                                 # read-only CI readiness
skillset check --ci --fix                           # repair safe source-driven drift
skillset check --ci --since origin/main             # change baseline override
skillset check --ci --report skillset-ci-report.md  # PR-comment/job-summary report
skillset init --include ci --yes            # scaffold .github/workflows/skillset-ci.yml
```

This repo's `bun run check` remains the default local and hosted CI aggregate. It runs the tracked test corpus, which includes the fast deterministic projection and adapter conformance suites. Use `bun run conformance:fast` only when you want a focused rerun of those suites without the rest of the tests. `bun run conformance:external` remains an opt-in slower lane and must not be folded into `bun run check` or scaffolded CI while it needs network access or large cloned repos.

Source-driven generated-output drift is the only mechanically repairable problem. With `--fix`, CI rebuilds only after the other checks pass and only when managed outputs still match their recorded hashes. Target-side edits are never overwritten, and drift identified as a provider-format migration remains the responsibility of `skillset update`. Lint issues, change-entry failures, unresolved baselines, package Changesets issues, and build errors stay report-only.

Skillset uses two separate change ledgers. `.skillset/changes/` records source-unit and loadout provenance for Skillset releases. `.changeset/*.md` records npm-facing release intent for the published `skillset` package. `skillset check --ci` checks both against the branch baseline.

Generated entity `CHANGELOG.md` files are managed projections. When one has been edited directly, `--fix` refuses to overwrite it and the report points to `skillset change reason <@ref>`, `skillset change amend <@ref>`, or `skillset release amend <@ref>` as appropriate.

For added or changed generated paths, CI runs the same read-only ownership and safety classification used by `skillset reconcile`. Reports include the generated path, owning source path when known, whether output-wins is available or refused, and the next manual command. CI never chooses a conflict direction automatically.

[Source Suggestions](source-suggestions.md) is the future recovery path for managed generated-output edits that should become source changes. CI writeback remains future-only until the local suggestion command can classify clean source patches, refusal cases, and stale lock/conflict risks.

`skillset init --include ci` scaffolds `.github/workflows/skillset-ci.yml`. The workflow is user-owned after creation: rerunning `init --include ci` reports an edited workflow as existing and never overwrites it. The scaffolded workflow:

- runs `skillset check --ci --fix` on same-repo pull requests and plain `skillset check --ci` on fork pull requests or pushes to `main`;
- appends the Markdown report to the job summary on every run;
- commits and pushes mechanical rebuilds back to same-repo pull-request branches;
- posts (or updates) the report as a PR comment when non-mechanical problems remain, then fails the check.

Fork pull requests cannot receive pushes or comments with the default `GITHUB_TOKEN`, so the scaffold keeps them read-only; they still get the failing check and the job-summary report.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `skillset check --ci` mode | n/a | n/a | `implemented` | Workflow tooling, not a rendered source feature. |
| `--include ci` workflow scaffold | n/a | n/a | `implemented` | Writes `.github/workflows/skillset-ci.yml` once; user-owned afterwards. |

## Diagnostics

The report separates five sections: stale generated output (mechanical; fixed by `--fix` or `skillset build --yes`), lint issues, change errors and warnings (fix with `skillset change add`, or `skillset change migrate --yes` for valid legacy frontmatter entries), package Changesets issues (fix with `.changeset/*.md` or by removing stray package release intent), and build errors. A change-check infrastructure failure (for example no resolvable baseline in a shallow clone) is reported distinctly so CI configuration problems are not mistaken for missing entries; the scaffolded workflow checks out with `fetch-depth: 0` to keep `origin/main` resolvable.

Exit status is non-zero whenever a non-mechanical problem remains, or when drift remains and `--fix` was not passed. With `--fix`, a run whose only problem was drift exits zero after rebuilding, which lets the workflow commit the rebuild instead of failing.

The Markdown report starts with the `<!-- skillset-ci-report -->` marker so workflows can find and update an existing comment instead of stacking new ones.

## Provenance

`skillset check --ci` creates no source truth and never publishes, installs, or mutates user or runtime config. Its only writes are safe source-driven generated-output repairs requested with `--fix` and the report file passed to `--report`. The scaffolded workflow is plan-listed by `init` and written only with `--yes`.

## Evidence

See `src/ci.ts`, `src/__tests__/ci.test.ts`, and this repo's own [.github/workflows/ci.yml](../../.github/workflows/ci.yml), which dogfoods the scaffolded workflow shape against the local compiler.

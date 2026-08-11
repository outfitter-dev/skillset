---
description: Skillset CI provides branch-aware readiness checks, bounded output repair, reports, and a workflow scaffold.
---

# CI

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `workflows` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Registry feature: `workflows`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

`skillset check --ci` adds Git-baseline change coverage, package Changesets awareness, and a stable report to the ordinary source and [generated-output](../../glossary.md#generated-output) readiness check.

## Run the Check

```bash
skillset check --ci
skillset check --ci --since origin/main
skillset check --ci --report skillset-ci-report.md
skillset check --ci --fix
```

The [continuous-integration guide](../../guides/continuous-integration.md) owns setup and branch workflow. The generated [`check` reference](../cli/check.md) owns exact flags.

The report separates source lint, [workspace](../../glossary.md#workspace) change coverage, package Changesets, build errors, and generated-output [drift](../../glossary.md#drift). Terminal, Markdown, and JSON results carry the same recovery action, reason, path/ref/scope, and applicable commands. Markdown starts with `<!-- skillset-ci-report -->` so a workflow can update one PR comment.

## Know What `--fix` Can Write

Without `--fix`, the check is read-only except for the explicitly requested report file. With `--fix`, Skillset rebuilds only when source-driven output drift is the sole blocking condition and managed files still match their recorded hashes.

`--fix` refuses to overwrite target-side edits, repair lint or change-entry failures, resolve a missing Git baseline, create a package Changeset, or apply a provider-format migration. Use [`update`](../cli/update.md) for provider-format migrations and [reconciliation](source-suggestions.md) when a managed output edit should become source.

Generated changelog edits also remain source-side decisions. Use `change reason` before release, `change amend` for applied source-change wording, or `release amend` for release-event notes.

## Exit Behavior

| State | Exit |
| --- | --- |
| Everything is ready | Zero |
| Drift remains and `--fix` was not passed | Nonzero |
| Drift was the only problem and `--fix` repaired it | Zero |
| Any lint, change, Changesets, build, baseline, or unsafe-output problem remains | Nonzero |

A shallow clone with no resolvable comparison baseline is reported as CI infrastructure failure, not as a missing change entry.

## Scaffold the Workflow

```bash
skillset init --include ci
skillset init --include ci --yes
```

The plan previews `.github/workflows/skillset-ci.yml`; `--yes` writes it once. The workflow is user-owned afterward and is never overwritten by a later init.

The scaffold uses `--fix` for same-repository pull requests, stays read-only for forks and pushes to `main`, writes the report to the job summary, and can commit a safe mechanical rebuild back to a same-repository PR branch. Forks cannot receive default-token pushes or comments, so they receive the failing check and job summary only. It checks out full history so the baseline is resolvable.

## Errors and Recovery

| Problem | Recovery |
| --- | --- |
| No Git baseline | Fetch full history or pass a resolvable `--since` ref |
| Source or config diagnostic | Fix the first source-positioned error |
| Missing change coverage | Add or refresh a [change reason](changes.md) |
| Missing package Changeset | Add the package-facing Changeset when required |
| Provider-format drift | Preview `skillset update` |
| Managed output edit | Choose `reconcile --use source` or a safe `--use output` plan |
| Mixed blockers | Resolve each named blocker; `--fix` remains disabled |

CI reports classify generated-path reconciliation but never choose source-wins or output-wins and never perform future CI source writeback.

## Provenance

The check creates no new source authority and never publishes, installs, trusts, activates, or mutates runtime configuration. A safe `--fix` updates ordinary generated files and locks; `--report` writes only its selected report path. Core's source-readiness result remains independent of Git and CLI policy in `packages/core/src/source-readiness.ts`.

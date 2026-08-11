---
description: Adds Skillset readiness checks to CI and limits automatic repair to safe source-driven generated-output drift.
---

# Verify Skillset in Continuous Integration

Continuous integration checks a Skillset [workspace](../glossary.md#workspace), its authored source, committed [generated output](../glossary.md#generated-output), and required release intent against a Git baseline. It does not publish, install, trust, or prove [activation](../glossary.md#activation).

## Scaffold the Workflow

Preview the optional GitHub Actions scaffold without allowing an interactive write:

```bash
bunx skillset init --include ci --json
```

Then authorize the reviewed addition:

```bash
bunx skillset init --include ci --yes
```

This creates `.github/workflows/skillset-ci.yml`. The workflow is user-owned after creation: later `init` runs report it as existing and do not replace your edits. Review its permissions and consider pinning the Skillset version before relying on it as a required check.

The generated [`init` reference](../reference/cli/init.md) owns the complete option inventory.

## Reproduce the Check Locally

Run the same branch-aware readiness mode against your trunk ref:

```bash
bunx skillset check --ci --since origin/main
```

To create the same Markdown report used by job summaries and pull-request comments, request a report file explicitly:

```bash
bunx skillset check --ci --since origin/main --report skillset-ci-report.md
```

Without `--fix`, the check does not rewrite source or generated output. The requested report is its only repository-facing write. See the generated [`check` reference](../reference/cli/check.md) for exact syntax.

## Decide Whether CI May Repair Drift

`--fix` is a write request. It repairs [drift](../glossary.md#drift) only when source-driven generated output is the sole blocker and the managed files still match their recorded ownership hashes:

```bash
bunx skillset check --ci --fix --since origin/main
```

It does not overwrite [target-side](../glossary.md#target) edits or unmanaged collisions. It also does not repair lint failures, invent missing source-change reasons or package Changesets, resolve an unavailable Git baseline, perform provider-format migrations, or hide [build](../glossary.md#build) failures. Mixed blockers remain report-only until each owning workflow resolves them.

Use [troubleshooting](../troubleshooting.md) for recovery by symptom. The exhaustive [CI feature reference](../reference/features/ci.md) owns the diagnostic and repair contract.

## Understand the Scaffolded Job

The GitHub Actions scaffold checks out full history so `origin/main` can be resolved. On a same-repository pull request it may run `--fix`, commit a mechanical rebuild, push it to the pull-request branch, and update a report comment. On a fork pull request it remains read-only and writes the report only to the job summary because the default token cannot push to or comment on the fork.

A fix pushed with `GITHUB_TOKEN` does not retrigger workflows automatically. If branch protection requires checks on that new commit, choose and review an authentication policy appropriate for the repository rather than adding credentials to Skillset source.

## Keep Release Intent Separate

Skillset checks two independent records:

- `.skillset/changes/` records [source-unit](../glossary.md#source-unit) and workspace release provenance.
- `.changeset/*.md` records npm package release intent when package-facing code changes.

One does not satisfy the other. See [Changes](../reference/features/changes.md), [Releases](../reference/features/releases.md), and [publishing](publishing.md) for their respective workflows.

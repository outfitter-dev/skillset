---
description: Separates workspace releases, downstream distribution planning, marketplace catalogs, and npm package publication.
---

# Prepare Skillset Work for Publication

Skillset has no general `publish` command. Choose the workflow that owns the thing you intend to ship:

| Outcome | Owning workflow |
| --- | --- |
| Version and release a [workspace](../glossary.md#workspace) [source unit](../glossary.md#source-unit) | `skillset change` and `skillset release` |
| Inspect a downstream sync of built files | `skillset distribute plan` |
| Curate provider catalog entries | [Marketplace workflow](marketplaces.md) |
| Publish the `skillset` npm package | Maintainer-owned Changesets and GitHub Actions |

A workspace release can refresh [generated output](../glossary.md#generated-output), but it does not upload it to an external [destination](../glossary.md#destination) or prove runtime [activation](../glossary.md#activation).

## Release Workspace Source Units

Inspect source changes first:

```bash
bunx skillset change status
```

If a changed source unit has no pending record, create one with the scope and release impact you intend:

```bash
bunx skillset change add --scope skill:review-notes --bump patch --reason "Describe the reader-visible change."
```

To revise an existing record, use the reference returned by `change add` or run `bunx skillset change list` to find it, then replace the example `@abcdef`:

```bash
bunx skillset change reason @abcdef --reason "Clarify the reader-visible change."
```

Both commands write source-side release evidence. Once the reasons and version impact are correct, preview and apply the release:

```bash
bunx skillset release plan
bunx skillset release apply --yes
```

The confirmed apply appends release evidence, advances source-unit version authority, refreshes generated changelogs, locks, and configured provider output, and consumes the pending changes included in the plan. It writes repository state; it does not publish over a network, install provider output, or change user-level runtime configuration.

Verify the result:

```bash
bunx skillset release audit
bunx skillset check
```

The [Changes reference](../reference/features/changes.md) and [Releases reference](../reference/features/releases.md) own the ledger, amendment, version, and changelog details. Exact commands live in the generated [`change`](../reference/cli/change.md) and [`release`](../reference/cli/release.md) pages.

## Plan Downstream Distribution

Root `distributions` configuration selects an already enabled [target](../glossary.md#target) [rendering](../glossary.md#render) and describes a local or Git destination. Inspect every configured plan, or one named plan:

```bash
bunx skillset distribute plan
bunx skillset distribute plan codex-marketplace
```

Distribution is plan-only. The command does not accept `--yes`; it does not copy files, commit, push, open a pull request, or install runtime configuration. Local plans can report `add`, `change`, and `unchanged`; Git destinations remain `unknown` until a sync workflow is implemented to inspect them.

See [Distributions](../reference/features/distributions.md) for configuration, selection, and downstream ownership, and the generated [`distribute` reference](../reference/cli/distribute.md) for command syntax.

## Publish the Compiler Package

This lane applies only to maintainers of the Skillset repository. Package-facing changes carry a `.changeset/*.md` entry, and the repository's Release workflow versions and publishes the unscoped `skillset` npm package after its policy gates pass.

The safe local checks are:

```bash
bun run changeset:check
bun run publish:check
```

GitHub Actions is the package release operator. Do not run `publish:packages` locally as a normal workflow, and do not infer approval to merge or publish from a successful preflight. The maintainer-only [Package Releases](../development/package-releases.md) page owns package-facing paths, release labels, protected environments, trusted publishing, and recovery.

Workspace source-unit releases, npm package releases, distributions, and marketplace indexes remain separate evidence. Completing one lane does not complete or authorize another.

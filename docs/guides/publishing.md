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
| Make individual skills installable from a repository | Commit eligible generated `.agents/skills/` output |
| Publish the `skillset` npm package | Maintainer-owned Changesets and GitHub Actions |

A workspace release can refresh [generated output](../glossary.md#generated-output), but it does not upload it to an external [destination](../glossary.md#destination) or prove runtime [activation](../glossary.md#activation).

## Release Workspace Source Units

Inspect source changes first:

```bash
skillset change status
```

If a changed source unit has no pending record, create one with the scope and release impact you intend:

```bash
skillset change add --scope skill:review-notes --bump patch --reason "Describe the reader-visible change."
```

To revise an existing record, use the reference returned by `change add` or run `skillset change list` to find it, then replace the example `@abcdef`:

```bash
skillset change reason @abcdef --reason "Clarify the reader-visible change."
```

Both commands write source-side release evidence. Once the reasons and version impact are correct, preview and apply the release:

```bash
skillset release plan
skillset release apply --yes
```

The confirmed apply appends release evidence, advances source-unit version authority, refreshes generated changelogs, locks, and configured provider output, and consumes the pending changes included in the plan. It writes repository state; it does not publish over a network, install provider output, or change user-level runtime configuration.

Verify the result:

```bash
skillset release audit
skillset check
```

The [Changes reference](../reference/features/changes.md) and [Releases reference](../reference/features/releases.md) own the ledger, amendment, version, and changelog details. Exact commands live in the generated [`change`](../reference/cli/change.md) and [`release`](../reference/cli/release.md) pages.

## Plan Downstream Distribution

Root `distributions` configuration selects an already enabled [target](../glossary.md#target) [rendering](../glossary.md#render) and describes a local or Git destination. Inspect every configured plan, or one named plan:

```bash
skillset distribute plan
skillset distribute plan codex-marketplace
```

Distribution is plan-only. The command does not accept `--yes`; it does not copy files, commit, push, open a pull request, or install runtime configuration. Local plans can report `add`, `change`, and `unchanged`; Git destinations remain `unknown` until a sync workflow is implemented to inspect them.

See [Distributions](../reference/features/distributions.md) for configuration, selection, and downstream ownership, and the generated [`distribute` reference](../reference/cli/distribute.md) for command syntax.

## Publish Individual Agent Skills

When Agent Skills is adopted, Skillset intrinsically renders each eligible standalone skill under `.agents/skills/<skill>/`. To make those standalone skills available from a Git repository, commit the generated skill directories and their nearby `skillset.lock` after a successful build and check:

```bash
skillset build
skillset check
```

A downstream consumer can then select one skill from the repository root. For example, the pinned Skills consumer used by this repository accepts:

```bash
npx skills add <repository> --skill <skill> --agent codex --copy --yes
```

Repository-root discovery is the preferred route. The pinned consumer finds the conventional `.agents/skills` tree before a valid manifest-resolved Claude duplicate and selects by the exact skill frontmatter name. Treat a root `SKILL.md` or same-name root `skills/` entry as a conflict: the current consumer checks those locations first, and a root `SKILL.md` stops broader discovery. `--full-depth` broadens discovery into nested paths and should be reserved for repositories that intentionally need that wider scan. When a repository cannot remove a higher-priority conflict, scope discovery explicitly to `<repository>/.agents/skills`.

Plugin-owned skills are published as part of their canonical Agent Plugins package at `plugins/<plugin>/agents/skills/<skill>/`. Skillset does not publish a second standard-owned copy under the repository `.agents/skills/` root. A project-use copy is a separate projection with its own destination ownership; it is not part of individual Agent Skills publication.

Generation and consumer installation are separate actions. `skillset build` does not upload, publish, install, trust, or activate anything, and it does not change user-level configuration. If a repository previously exposed a Claude marketplace bundle as an interim individual-skill source, keep that native catalog correct and publish only the intended standalone `.agents/skills` tree alongside it; do not repoint the Claude catalog at a cross-provider path.

## Publish the Compiler Package

This lane applies only to maintainers of the Skillset repository. Package-facing changes carry a `.changeset/*.md` entry, and the repository's Release workflow versions and publishes the unscoped `skillset` npm package after its policy gates pass.

The safe local checks are:

```bash
bun run changeset:check
bun run publish:check
```

GitHub Actions is the package release operator. Do not run `publish:packages` locally as a normal workflow, and do not infer approval to merge or publish from a successful preflight. The maintainer-only [Package Releases](../development/package-releases.md) page owns package-facing paths, release labels, protected environments, trusted publishing, and recovery.

Workspace source-unit releases, npm package releases, distributions, and marketplace indexes remain separate evidence. Completing one lane does not complete or authorize another.

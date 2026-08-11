---
description: Builds one standalone skill from canonical source and verifies its repo-local provider-native output.
---

# Build Your First Skill

This path adds Skillset to an existing repository, authors one [source unit](../glossary.md#source-unit), and verifies its [generated output](../glossary.md#generated-output). It assumes you already installed the package with `bun add --dev @skillset/cli`.

## Initialize the repository

From the repository root, print a non-interactive setup plan:

```bash
bunx @skillset/cli init --json
```

The JSON result records an empty write set. Review it, then authorize initialization:

```bash
bunx @skillset/cli init --yes
```

The confirmed command writes the reviewed scaffold and also seeds `.skillset/changes/state.json`, the [workspace's](../glossary.md#workspace) initial [release state](../reference/features/releases.md). That release-state seed exists only after confirmation and is not listed as a previewed scaffold write.

Initialization creates the root `skillset.yaml` workspace manifest and the `.skillset/` [source root](../glossary.md#source-root). It does not change user-level provider configuration.

If you want a new repository dedicated to agent material, use `bunx @skillset/cli create my-skillset --yes` instead. The generated [CLI reference](../reference/cli/README.md) owns the complete command and option inventory.

## Create one skill

Print a non-interactive source-scaffold plan:

```bash
bunx @skillset/cli new skill "Review Notes" --json
```

The JSON result records an empty write set. Review it, then rerun the same scaffold with explicit write authority:

```bash
bunx @skillset/cli new skill "Review Notes" --yes
```

Edit `.skillset/skills/review-notes/SKILL.md` so it contains useful triggering guidance:

```markdown
---
name: review-notes
title: Review Notes
description: Use when turning meeting notes into decisions, follow-ups, and risks.
---

# Review Notes

- Identify concrete decisions.
- Pull out follow-ups and named owners.
- Keep unresolved risks separate from agreed next steps.
```

The directory name is the stable identity. `title` is display text, and `description` tells an agent when the skill is relevant. The [skill reference](../reference/features/skills.md) owns the complete field and support contract.

## Preview the build

Preview the [render](../glossary.md#render) plan:

```bash
bunx @skillset/cli build
```

The plan names the repo-local [destinations](../glossary.md#destination) that would change. With the default [targets](../glossary.md#target), a standalone skill can produce files under `.claude/skills/`, `.agents/skills/`, and `.cursor/skills/`, each with generated provenance.

## Write and verify

Write the reviewed plan:

```bash
bunx @skillset/cli build --yes
```

Then prove the checked-in output matches source:

```bash
bunx @skillset/cli check --only outputs
```

The comprehensive check should now pass too:

```bash
bunx @skillset/cli check
```

Open one generated `SKILL.md` and its nearby `skillset.lock`. The rendered file is [provider-native](../glossary.md#provider-native) output; the lock records ownership and hashes. Keep editing `.skillset/skills/review-notes/SKILL.md`, not the generated copy.

## Make one change

Change the authored skill body, then run:

```bash
bunx @skillset/cli diff
bunx @skillset/cli build
bunx @skillset/cli build --yes
bunx @skillset/cli check --only outputs
```

That is the core source-first loop: edit [canonical source](../glossary.md#canonical-source), inspect [drift](../glossary.md#drift), write deliberately, and verify.

## Next

- Walk through the checked-in [first-author example](first-author.md).
- Learn [how rendering works](how-rendering-works.md).
- Use the [development loop](../guides/development-loop.md) for daily work.
- If a command fails, start with [troubleshooting](../troubleshooting.md).

Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](build-versus-activation.md).

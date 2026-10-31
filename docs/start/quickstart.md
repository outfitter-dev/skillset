---
description: Builds one standalone skill from canonical source and verifies its repo-local provider-native output.
---

# Build Your First Skill

This path adds Skillset to an existing repository, authors one [source unit](../glossary.md#source-unit), and verifies its [generated output](../glossary.md#generated-output). It assumes the global `skillset` command is available; see [Install Skillset](installation.md) if it is not.

## Initialize the repository

From the repository root, print a non-interactive setup plan:

```bash
skillset init --json
```

The JSON result records an empty write set. If the repository already has `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, or provider skills, first review the [existing-repository guidance](../troubleshooting.md#the-first-build-finds-existing-root-guidance) and [adoption workflow](../guides/importing.md). Native root `AGENTS.md` is retained automatically; other provider originals may require reviewed cutover. Review the plan, then authorize initialization:

```bash
skillset init --yes
```

The confirmed command writes the reviewed scaffold and also seeds `.skillset/changes/state.json`, the [workspace's](../glossary.md#workspace) initial [release state](../reference/features/releases.md). That release-state seed exists only after confirmation and is not listed as a previewed scaffold write.

Initialization creates root `skillset.yaml` and the `.skillset/` [source root](../glossary.md#source-root). Without native root `AGENTS.md`, it seeds `.skillset/RULES.md`; under the default targets, that front page renders root `AGENTS.md` and `.claude/CLAUDE.md`. The scaffold sets `cursor: false` on this root front page. With unmanaged root `AGENTS.md`, initialization instead records `workspace.nativeAgents: true`, preserves that file as source, and omits `RULES.md`. Source `.gitkeep` placeholders do not become generated provider files.

Confirmed initialization reports release baselines separately from scaffold files. A fresh empty workspace seeds the config and root-rule baselines in `.skillset/changes/state.json`; existing source can add more. Read the confirmed `baselines` result rather than assuming a fixed count. Initialization does not change user-level provider configuration.

If you want a new repository dedicated to agent material, use `skillset create my-skillset --yes` instead. The generated [CLI reference](../reference/cli/README.md) owns the complete command and option inventory.

## Create one skill

Print a non-interactive source-scaffold plan:

```bash
skillset new skill "Review Notes" --json
```

The JSON result records an empty write set. Review it, then rerun the same scaffold with explicit write authority:

```bash
skillset new skill "Review Notes" --yes
```

The scaffold contains identity fields only. Author its description and body before building; ordinary and draft skills are still eligible for project output. An omitted skill description falls back to its display name or ID during rendering, which is not a useful trigger description.

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
skillset build
```

The plan includes root guidance as well as any skills you added. Native `AGENTS.md` is never a write destination; the default Claude front page remains generated. Existing unmanaged provider files block a live write until you review and resolve their collisions.

The plan names the repo-local [destinations](../glossary.md#destination) that would change. `compile.targets` selects provider output such as `.claude/skills/` and `.cursor/skills/`. Separately, applicable skill source produces `.agents/skills/` whenever the Agent Skills [standard profile](../glossary.md#standard-profile) is adopted. Codex can consume that same physical tree as a provider [delta](../glossary.md#delta); the nearby [lock](../glossary.md#lock) records one [owner](../glossary.md#owner) and both logical [consumers](../glossary.md#consumer) instead of treating `agents` as a provider.

## Write and verify

Write the reviewed plan:

```bash
skillset build --yes
```

Then prove the checked-in output matches source:

```bash
skillset check --only outputs
```

The comprehensive check should now pass too:

```bash
skillset check
```

Open one generated `SKILL.md` and its nearby `skillset.lock`. A rendered file may be an [Agent standard](../glossary.md#agent-standard) projection, a [provider-native](../glossary.md#provider-native) projection, or a shared physical file with both consumers; the lock records ownership, consumers, and hashes. Keep editing `.skillset/skills/review-notes/SKILL.md`, not the generated copy.

## Make one change

Change the authored skill body, then run:

```bash
skillset diff
skillset build
skillset build --yes
skillset check --only outputs
```

That is the core source-first loop: edit [canonical source](../glossary.md#canonical-source), inspect [drift](../glossary.md#drift), write deliberately, and verify.

## Next

- Walk through the checked-in [first-author example](first-author.md).
- Learn [how rendering works](how-rendering-works.md).
- Use the [development loop](../guides/development-loop.md) for daily work.
- If a command fails, start with [troubleshooting](../troubleshooting.md).

Build commands render files without installing, trusting, activating, symlinking, or mutating user-level provider configuration. See [Build Versus Activation](build-versus-activation.md).

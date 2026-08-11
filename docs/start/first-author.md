---
description: Walks through the executable first-author fixture from clean check to source edit and deterministic regeneration.
---

# Walk Through the First-Author Example

The checked-in [`examples/first-author`](../../examples/first-author/README.md) fixture is the smallest complete Skillset [workspace](../glossary.md#workspace) in this repository. It contains one skill, one instruction rule, Claude and Codex [targets](../glossary.md#target), and their committed [generated output](../glossary.md#generated-output). Work in a disposable copy so the canonical fixture stays clean.

Use this walkthrough to see the full loop without inventing source first.

## Copy the workspace

From the Skillset repository root:

```bash
fixture_dir="$(mktemp -d)/first-author"
cp -R examples/first-author "$fixture_dir"
```

## Inspect the workspace

The authored side is:

```text
first-author/
  skillset.yaml
  .skillset/
    rules/team-guidance.md
    skills/review-notes/SKILL.md
```

The root manifest selects targets and [destinations](../glossary.md#destination). The `.skillset/` tree is the [canonical source](../glossary.md#canonical-source). Provider directories, `AGENTS.md`, and lock files are generated [projections](../glossary.md#projection).

## Prove the fixture starts clean

From the Skillset repository root, run the workspace CLI against the fixture:

```bash
bun ./apps/skillset/src/cli.ts check --root "$fixture_dir"
bun ./apps/skillset/src/cli.ts check --only outputs --root "$fixture_dir"
```

Both commands should pass. The first checks authored source and compatibility; the second checks generated-output freshness.

## Preview a no-op build

```bash
bun ./apps/skillset/src/cli.ts build --root "$fixture_dir"
```

The [build](../glossary.md#build) is preview-only. Because the fixture begins clean, it should not need to write managed output.

## Edit canonical source

Open `$fixture_dir/.skillset/skills/review-notes/SKILL.md` and add one recognizable sentence to the body. Do not edit the generated copies.

Now the output-only check should fail because source and generated destinations have [drifted](../glossary.md#drift):

```bash
bun ./apps/skillset/src/cli.ts check --only outputs --root "$fixture_dir"
```

Previewing a build reports the pending changes but still writes nothing:

```bash
bun ./apps/skillset/src/cli.ts build --root "$fixture_dir"
```

## Regenerate and verify

Write the reviewed plan and recheck it:

```bash
bun ./apps/skillset/src/cli.ts build --root "$fixture_dir" --yes
bun ./apps/skillset/src/cli.ts check --only outputs --root "$fixture_dir"
```

Your sentence should now appear in both:

```text
$fixture_dir/.claude/skills/review-notes/SKILL.md
$fixture_dir/.agents/skills/review-notes/SKILL.md
```

Run the confirmed build once more. A second build with unchanged source should be a no-op; deterministic output should not churn.

## Use the standalone commands

In a copied or cloned standalone fixture with Skillset installed, the same loop is:

```bash
bunx skillset check
bunx skillset build
bunx skillset build --yes
bunx skillset check --only outputs
```

Continue with [How Rendering Works](how-rendering-works.md) for the model behind the loop, or the [development loop](../guides/development-loop.md) for everyday editing.

Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](build-versus-activation.md).

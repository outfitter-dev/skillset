# First Author Skillset Example

This is a tiny root-layout Skillset source repo. It is meant to be cloned,
copied, or used in place from the Skillset checkout when you want to see the
first author loop with real source files and generated Claude/Codex output.

It contains:

- one standalone skill source at `skillset/skills/review-notes/SKILL.md`;
- one portable instruction rule at `skillset/rules/team-guidance.md`;
- a root `skillset.yaml` manifest that targets Claude and Codex;
- checked-in generated Claude and Codex output so `check` and `verify` pass
  immediately after cloning.

## Try It

From the Skillset repo root:

```bash
bun ./apps/skillset/src/cli.ts check --root examples/first-author
bun ./apps/skillset/src/cli.ts build --root examples/first-author
bun ./apps/skillset/src/cli.ts build --root examples/first-author --yes
bun ./apps/skillset/src/cli.ts check --only outputs --root examples/first-author
bun ./apps/skillset/src/cli.ts dev --root examples/first-author
```

From a standalone clone after installing Skillset, use the package command:

```bash
skillset check
skillset build
skillset build --yes
skillset check --only outputs
skillset dev
```

## Expected Output

The checked-in target-native output is:

```text
.claude/skills/review-notes/SKILL.md
.claude/skills/skillset.lock
.agents/skills/review-notes/SKILL.md
.agents/skills/skillset.lock
.claude/rules/team-guidance.md
.claude/rules/skillset.lock
AGENTS.md
skillset.lock
```

Skillset does not install, trust, symlink, or activate these files in
user-level Claude or Codex runtime config.

## Edit The Source

Change the skill body or rule guidance, then rerun:

```bash
skillset check
skillset build
skillset build --yes
skillset check --only outputs
```

Use `skillset diff` to inspect pending generated changes and `skillset explain`
with either a source path or generated path when you want provenance details.
Use `skillset dev` for the same diagnostics and generated-output preview
as a foreground watch loop. It writes nothing; use `skillset build --yes` when
you want to refresh repo-local generated output.

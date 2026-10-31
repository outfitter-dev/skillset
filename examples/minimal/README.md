# Minimal Skillset Example

This is a tiny canonical-layout Skillset source repo. It is meant to be cloned,
copied, or used in place from the Skillset checkout when you want to see the
first author loop with real source files and generated Claude/Codex output.

It contains:

- one standalone skill source at `.skillset/skills/review-notes/SKILL.md`;
- one portable rule at `.skillset/rules/team-guidance.md`;
- a root `skillset.yaml` manifest that targets Claude and Codex;
- checked-in generated Claude and Codex output so `check` passes
  immediately after cloning.

## Try It

From the Skillset repo root, these commands only read the example, so they
are safe to run in place:

```bash
bun ./apps/skillset/src/cli.ts check --root examples/minimal
bun ./apps/skillset/src/cli.ts check --only outputs --root examples/minimal
bun ./apps/skillset/src/cli.ts build --root examples/minimal
bun ./apps/skillset/src/cli.ts dev --root examples/minimal
```

`build` without `--yes` only previews. To write output, work in a disposable
copy so the canonical example stays unchanged:

```bash
work="$(mktemp -d)/minimal"
cp -R examples/minimal "$work"
bun ./apps/skillset/src/cli.ts build --root "$work" --yes
bun ./apps/skillset/src/cli.ts check --only outputs --root "$work"
```

From a standalone copy after installing Skillset, use the package command:

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

Build commands render files without installing, trusting, activating, symlinking, or mutating user-level provider configuration. See [Build Versus Activation](../../docs/start/build-versus-activation.md).

## Edit The Source

Make edits in your copy, not in the Skillset checkout. Change the skill body or rule guidance. The first check below is expected to report generated-output drift and exit non-zero; then preview and write the regeneration:

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

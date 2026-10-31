# Guided Root Guidance Adoption

Use this workflow when adding Skillset to a repository whose useful guidance is in root `CLAUDE.md`, `.claude/CLAUDE.md`, or an authored `AGENTS.md`. Claude files are never native Skillset sources. The agent evaluates and synthesizes guidance; the compiler preserves files and validates the selected source contract.

## Inspect and propose

1. Read root `AGENTS.md`, root `CLAUDE.md`, `.claude/CLAUDE.md`, existing `skillset.yaml`, `.skillset/RULES.md`, scoped rules, and relevant lock ownership. Follow references needed to understand the guidance. Distinguish authored files from managed output; a generated file with hand edits requires explicit recovery review.
2. Run `skillset init --json` when setting up a workspace. The preview writes nothing. Record other provider artifacts and collisions so root guidance does not hide an unrelated skill or plugin cutover.
3. Choose the source with the owner from the task's intent. Retain native `AGENTS.md` when it is the desired authority: setup discovers it automatically, records `workspace.nativeAgents: true`, and never writes it. If Claude guidance is stronger or AGENTS is absent, propose a synthesized `.skillset/RULES.md`. Do not infer authority from file size or silently discard conflicting instructions; surface substantive conflicts for resolution.
4. Draft the proposed guidance outside active source first. Preserve useful constraints and explain omissions or reconciliations. Keep provider-specific behavior explicit, keep directory-scoped rules scoped, and rebase relative links for the new source location. Do not flatten every referenced file into the root front page.

## Validate the proposed source

Use a disposable copy of the repository to prove the proposed cutover before changing the live originals. In that copy, preserve the originals in a backup location outside generated destinations, remove the authored root `AGENTS.md` if switching away from native mode, remove the `workspace.nativeAgents` key, and place the reviewed content in `.skillset/RULES.md`. Do not set the key to `false`; the supported opt-out removes it. Remove or reconcile competing unscoped source deliberately.

`--isolated` changes output locations; it does not waive the native-source conflict between authored `AGENTS.md` and `RULES.md`. Make the source choice coherent in the disposable copy before running:

```bash
skillset build --isolated --yes
skillset check --only outputs --isolated
```

Inspect the resulting `AGENTS.md` and configured Claude front page. The default Claude path is `.claude/CLAUDE.md`; `compile.instruction_front_page: repo-root` selects root `CLAUDE.md`. Confirm that both projections preserve the intended guidance and that relative links work from each output location. Compare against both original Claude placements, not just the selected output path.

## Apply the reviewed cutover

Within the owner's authorized scope, retain recoverable copies of all authored originals before moving any live path. Apply the reviewed `RULES.md` and source-choice configuration. When leaving native mode, both the authored root file and `workspace.nativeAgents` must leave their old roles; otherwise discovery or validation will retain the conflict. Preserve an unused Claude placement deliberately and check that it does not leave competing runtime instructions.

Run `skillset build` to preview live changes. Resolve each reported unmanaged collision only after reviewing its replacement; adoption never grants blanket overwrite authority. Then run:

```bash
skillset build --yes
skillset check --only outputs
skillset check
```

Record the source choice, preserved backups, remaining guidance conflicts, and actual validation results in the handoff. No installation, trust, global configuration, or provider activation is part of this workflow.

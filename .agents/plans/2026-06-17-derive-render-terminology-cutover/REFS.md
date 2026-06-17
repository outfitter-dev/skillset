# References

## Repo Guidance

- [AGENTS.md](/Users/mg/Developer/outfitter/skillset/AGENTS.md)
- [docs/tenets.md](/Users/mg/Developer/outfitter/skillset/docs/tenets.md)
- [.agents/plans/PLANNING.md](/Users/mg/Developer/outfitter/skillset/.agents/plans/PLANNING.md)

## Linear Issues

- [SET-122 — Mechanical rename to render-result vocabulary](https://linear.app/outfitter/issue/SET-122/mechanical-rename-to-render-result-vocabulary)
- [SET-123 — Cut config over to compile.unsupportedDestination](https://linear.app/outfitter/issue/SET-123/cut-config-over-to-compileunsupporteddestination)
- [SET-124 — Separate target and destination in render-result data](https://linear.app/outfitter/issue/SET-124/separate-target-and-destination-in-render-result-data)
- [SET-125 — Refresh docs and generated guidance for derive/render vocabulary](https://linear.app/outfitter/issue/SET-125/refresh-docs-and-generated-guidance-for-deriverender-vocabulary)
- [SET-126 — Add terminology guard for derive/render cutover](https://linear.app/outfitter/issue/SET-126/add-terminology-guard-for-deriverender-cutover)

## Planning Inputs

- `goal-planning` skill: `/Users/mg/.agents/skills/goal-planning/SKILL.md`
- Code review reference: `/Users/mg/.agents/skills/goal-planning/references/code-review.md`
- Source-control reference: `/Users/mg/.agents/skills/goal-planning/references/source-control.md`
- Context prime command run during planning: `bash /Users/mg/.agents/skills/goal-planning/scripts/context-prime.sh`

## Current Live Evidence From Planning

- `git status --short --branch`: `## main...origin/main` plus a pre-existing local modification to `fixtures/external/repos.yaml`.
- `gt log --stack --no-interactive`: current stack was only `main`.
- `gh pr list --state open --limit 30`: no open PRs.
- `gh release list --limit 5`: latest release `skillset v0.13.4`.
- `gh run list --limit 10`: latest `main` CI and Release workflows were successful.

## Useful Search Seeds

Use `rg`, then classify each hit before editing:

```bash
rg -n "lowering|lowered|lower\\b|projection|projected|render result|render-result|unsupportedDestination|compile\\.unsupported|target|destination" packages apps docs .skillset fixtures
rg -n "lowering outcome|loss ledger|unsupported destination|unsupportedDestination" packages apps docs .skillset fixtures
rg -n "compile\\.unsupported|unsupported:" packages apps docs .skillset fixtures
```

Expected high-touch areas:

- `packages/core/src/build.ts`
- `packages/core/src/lowering-*` or any files still named around old terms
- `docs/layout.md`
- `docs/target-surfaces.md`
- `docs/features/README.md`
- `docs/features/lowering-outcomes.md`
- `.skillset/skills/**`
- generated `.agents/skills/**` and `.claude/skills/**`
- fixture golden outputs and lock/report assertions

## Review Prompt Template

```markdown
Please review the current branch/stack for the derive/render terminology cutover. Score out of 5. Focus on whether active surfaces use the new vocabulary correctly, whether historical/provider terms are preserved only where justified, and whether behavior stayed stable except where the issue deliberately changes the contract.

Overall score: n/5

Summary:
<one short prose judgment>

Findings:
- P0/P1/P2/P3 — <file:line> — <finding>
  Prompt To Fix With AI:
  <concise fix prompt>

No-findings statement:
<what was inspected and what residual risk remains>
```

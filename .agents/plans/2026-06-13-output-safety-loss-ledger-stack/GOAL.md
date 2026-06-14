# Goal Prompt

```text
Work in /Users/mg/Developer/outfitter/skillset. Execute the stack described in .agents/plans/2026-06-13-output-safety-loss-ledger-stack/PLAN.md. Objective: deliver SET-19 output safety plus the SET-70 lowering outcomes/loss ledger continuation, SET-69 registry diagnostics/inspection where feasible, and bounded tail issues SET-55/54/105/106/107/108 if they fit safely.

Read first: AGENTS.md, docs/tenets.md, packet PLAN.md/REFS.md, and current Linear issue briefs. Keep RETRO.md as the durable ledger and update it after meaningful tracker, design, code, generated-output, verification, review, PR, merge, or release changes.

Use one branch per purpose, preferring Linear branch names. Start from clean main. Use Graphite if its local state is healthy enough; otherwise use vanilla git and record why. Keep PRs draft until checks and review loops are clean. Do not publish, install, trust, symlink, mutate user-level Claude/Codex config, or add remotes without explicit maintainer approval.

Core order: SET-19; SET-72/SET-79 docs; SET-107 if needed; SET-82/83/84; SET-85/86; SET-76/77/78; tail SET-106/108/105/55/54 only as bounded capacity allows. If a tail issue is deferred, leave a Linear comment explaining why and record it in RETRO.md.

Validation ladder: use narrow tests per branch; before handoff run bun run skillset:build, bun run skillset:check, bun run skillset:lint, bun run typecheck, bun test, bun run check, and git diff --check. Record exact commands/results/skips in RETRO.md.

Review loop: run local subagent/code-review passes on branch slices and full stack. Require score /5 plus P0-P3 findings and prompt-to-fix text. Fix P0/P1/P2; fix reasonable P3; file/update Linear for unresolved true P3s.

Done only when included issues are implemented or explicitly deferred with Linear comments, Linear state matches repo/PR state, review and verification are recorded, stack is merged to main if submitted, next beta is cut if merged behavior changed, and RETRO.md final state is complete/archive-ready.
```

/goal From `/Users/mg/Developer/outfitter/skillset`, execute `.agents/goals/2026-08-07-trails-migration-capability-unblock` to ready-pr.

## Objective
Make sibling PRs #393/SET-396 and #395/SET-394 ready: non-draft live-main siblings, mergeable, fresh merge-ref CI/local gates green, zero unresolved threads/bot findings/P0-P2, no unexplained P3. Record but ignore Cursor capacity errors per amendment.

## Read First
Root/scoped `AGENTS.md`; packet; goal-loop, local-review, Graphite procedures; tenets/schema docs; live issues/PRs. Use Trails #992 and TRL-1271–1275 only as evidence.

## Authority
From the main workspace, detach clean captive workers without deletion; restack each sibling independently with Graphite; resolve, regenerate, test, review/fix, commit, draft-submit, update Linear/PRs, resolve threads, and mark ready after all gates pass.

## Boundary
In: #393/#395, owning conflicts, tests/generated output, reviews, PR/Linear/blocker evidence, packet. Out: merge, queue, publish, release, deploy, destructive cleanup, unexplained force-overwrite, HOME/provider config, and TRL-1272–1275 implementation.

## Sequence
1. Refresh evidence; validate packet.
2. Release clean #393 captivity; restack only it on main; preserve provider-native-reference scope.
3. Run focused/broad gates plus three final-tip reviews; fix until clean.
4. Draft-submit #393; await fresh merge-ref CI; resolve feedback/errors; mark ready.
5. Return to main; release clean #395 captivity; restack only it independently; preserve executable-mode scope.
6. Repeat gates/reviews, draft submit, CI/feedback reconciliation, and readiness.
7. Update SET-394/396, Trails blockers, PR bodies, and `RETRO.md`; prove both ready.

## Loop
For each PR: inspect ownership, resolve minimally, regenerate via repo commands, run narrow then broad gates, run three independent reviews, fix on the owning branch, and repeat after code changes. Progress the sibling during safe external waits.

## Review Loop
Use `/Users/mg/.agents/skills/local-review/SKILL.md`; write JSON under packet `tmp/reviews/`. Three independent reviews per final tip. Fix every P0-P2 and reasonable P3; accepted P3s need evidence. Code changes invalidate prior final-tip approval.

## Verification
- Focused conflict/risk tests.
- `bun run typecheck`, `bun run schema:check`, `bun run skillset:check`, `bun run skillset:check:outputs`, `bun run skillset:check:ci`, `bun run conformance:fast`, `bun run changeset:check`.
- `bun run package-ownership:guard`, `bun run terminology:guard`, `bun run target-topology:guard`, `bun run check`, `bun run hooks:pre-push`, `git diff --check`.
- Exact refs/ancestry, fresh merge-ref CI, mergeability, non-draft, zero threads/blocking bot findings, clean reviews.

## Hard Rules
Keep #393/#395 siblings on main; never cross-absorb scope. Preserve unrelated dirt/commits. Do not hand-edit generated artifacts, weaken tests, merge, queue, publish, release, deploy, or start downstream work.

## Evidence Contract
Record preflight, ancestry, detaches/restacks/conflicts, generated diffs, checks, reviews, submissions, CI, feedback/bot dispositions, readiness, tracker updates, and forbidden-action audit in `RETRO.md`.

## Next Move
On failure, fix the lowest owner and rerun narrow then broad proof. After three identical failures, change approach and record evidence.

## Stop Rules
Stop only for destructive topology needs, unpreservable unexplained remote work, an unapproved product decision, authority unavailable for both siblings after recovery, or user pause. Conflicts, failures, findings, and CI waits are loops.

## Definition Of Done
Both PRs satisfy every ready-pr condition and PR/Linear/packet evidence is current.

## Not Done
Draft/conflicting PRs, stale checks, missing gates, unresolved non-amended findings, or local-only proof.

## Persistence
Resume from `RETRO.md`, refresh live state, poll waits every 5–10 minutes, update material evidence, and continue until done or a stop rule fires.

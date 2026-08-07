# Goal Execution Contract: Trails Migration Capability Unblock

Date: 2026-08-07
Status: Active
Spec: `.agents/goals/2026-08-07-trails-migration-capability-unblock/SPEC.md`
Plan: `.agents/goals/2026-08-07-trails-migration-capability-unblock/PLAN.md`
Prompt: `.agents/goals/2026-08-07-trails-migration-capability-unblock/PROMPT.md`
Retro: `.agents/goals/2026-08-07-trails-migration-capability-unblock/RETRO.md`
Refs: `.agents/goals/2026-08-07-trails-migration-capability-unblock/REFS.md`

## Completion Horizon

Ready-pr.

Complete only when both #393 and #395 are non-draft, independently based on
live `main`, mergeable, fresh merge-ref CI green, locally gate-clean, review
clean, thread-clean, bot-error-clean, and accurately reflected in Linear and
the packet.

Not complete when either PR is draft, conflicting, stale against `main`, green
only on a pre-restack head, missing a required check or review, carrying an
unresolved thread/bot error/P0-P2, or described by stale tracker evidence.

## Authority

- May detach a clean worker worktree to release branch captivity after exact
  status/HEAD evidence is recorded; may not delete the worktree or branch.
- May use Graphite from the main workspace for sync, checkout, independent
  restack, commit, draft submit, and readiness preparation.
- May resolve conflicts, regenerate outputs, run tests, fix findings, commit,
  push/submit drafts, update PR bodies/comments, update Linear, reply to and
  resolve review threads, and mark #393/#395 ready after every gate passes.
- May not merge, queue, publish, release, deploy, force-overwrite unexplained
  remote work, mutate user configuration, destructively clean, or begin
  TRL-1272–TRL-1275 implementation.

## Boundary

- In scope: SET-396/#393, SET-394/#395, main-workspace Graphite topology,
  directly affected tests/docs/generated output, local review artifacts,
  relevant Linear/Trails blocker evidence, and goal-packet records.
- Read-only evidence: Trails #992 and TRL-1271–TRL-1275 contracts.
- Out of scope: merge/release/publication, unrelated branches/worktrees,
  downstream migration implementation, global activation, HOME/provider state.

## Topology

Single coordinator operating from `/Users/mg/Developer/outfitter/skillset`.
PR #393 and PR #395 remain sibling branches whose sole parent is live `main`.
Fixes land on the owning branch only. Independent local-review lanes inspect
each final tip; source-control and tracker writes stay centralized.

## Steps

1. Packet and topology readiness
   - Outcome: packet validates, preflight is durable, clean worker ownership is
     proven, and exact branch ancestry is recorded.
   - Gate: no unexplained dirt or unreviewed external commit.
2. SET-396 / PR #393 reconciliation
   - Outcome: branch rests independently on live `main`; conflicts preserve
     provider-native-reference intent without SET-394 scope.
   - Gate: focused tests, generated checks, aggregate gates, and three final-tip
     reviews are clean.
3. PR #393 hosted readiness
   - Outcome: draft submit, current body, fresh merge-ref CI, resolved threads,
     no bot errors, then non-draft ready state.
4. SET-394 / PR #395 reconciliation
   - Outcome: branch rests independently on live `main`; conflicts preserve
     executable-mode intent without SET-396 scope.
   - Gate: focused tests, generated checks, aggregate gates, and three final-tip
     reviews are clean.
5. PR #395 hosted readiness and closeout
   - Outcome: draft submit, current body, fresh merge-ref CI, resolved threads,
     no bot errors, then non-draft ready state; Linear and packet are current.

## Reviews

- Run at least three independent local-review passes from each final PR tip.
- Reviewers use `/Users/mg/.agents/skills/local-review/SKILL.md` and write valid
  JSON under `tmp/reviews/<pr>/<reviewer>/round-<n>.json`.
- Fix every P0-P2 and reasonable P3 on the owning branch. Any accepted P3 needs
  explicit evidence and tracker/retro rationale.
- Re-review after any fix that changes the reviewed tip. Final readiness needs
  zero open P0-P2 and no unexplained P3.

## Evidence Contract

`RETRO.md` records preflight, ancestry, detach evidence, conflict decisions,
generated diffs, exact test/check results, review reports, final SHAs, Graphite
submit state, hosted CI runs, thread/bot dispositions, PR readiness, Linear
updates, and a forbidden-action audit.

## Verification

- Focused tests for the files/behavior changed during each conflict resolution.
- `bun run typecheck`
- `bun run schema:check`
- `bun run skillset:check`
- `bun run skillset:check:outputs`
- `bun run skillset:check:ci`
- `bun run conformance:fast`
- `bun run changeset:check`
- `bun run package-ownership:guard`
- `bun run terminology:guard`
- `bun run target-topology:guard`
- `bun run check`
- `bun run hooks:pre-push`
- `git diff --check`
- Fresh GitHub merge-ref CI, mergeability, draft state, review threads, review
  bot comments/errors, and exact head/base proof for each PR.

## Next Move

- On conflict: identify the owning intent, inspect both sides and adjacent tests,
  resolve minimally, regenerate via repo commands, then run focused checks.
- On failed check/review: fix the lowest owner and repeat narrow-to-broad proof.
- After three materially identical failures: change approach, narrow the repro,
  and record exact evidence; do not weaken the gate.
- If one PR waits externally, progress the independent sibling when safe.

## Waiting State

- Waiting may occur on PR-triggered CI, review bots, or mergeability refresh.
- Check with `gh pr view`, `gh pr checks`, GitHub review-thread queries, and
  bounded Actions inspection about every 5–10 minutes while progress is live.
- Continue when fresh final-head evidence arrives. A stale/missing run or bot
  error is not a clean result.
- Stop only when required external authority/service remains unavailable after
  documented recovery and no independent safe work remains.
- Last checked: 2026-08-07; both PRs are non-draft, independently
  mergeable/clean, fresh pull-request CI green, and thread-clean, but final-head
  Cursor Bugbot runs remain blocked by the shared external usage limit.

## Persistence

Resume from `RETRO.md`, then refresh live repo, Graphite, GitHub, Linear, and npm
state. Update the packet after every material topology, verification, review,
submission, CI, feedback, and readiness transition.

## Amendments

Record material changes to scope, sequence, gates, topology, or authority in
`RETRO.md`. Do not weaken the ready-pr horizon, independent-sibling topology,
review/CI requirements, or forbidden-action boundary without user approval.

## Stop Rules

- Safe topology repair would require deleting/destructively cleaning a
  worktree/branch or force-overwriting unexplained remote work.
- Preserving the reviewed contract requires an unapproved product/ADR decision.
- Required credentials or service authority remain unavailable after bounded
  recovery attempts and block both PRs.
- The user pauses or changes the goal.

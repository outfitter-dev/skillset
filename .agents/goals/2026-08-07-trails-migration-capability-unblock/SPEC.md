# Specification: Trails Migration Capability Unblock

Date: 2026-08-07
Status: Active

## Objective

Bring independent Skillset PRs #393 / SET-396 and #395 / SET-394 to the
`ready-pr` completion horizon without merging, queuing, publishing, releasing,
deploying, or starting downstream Trails implementation.

## Context

- PR #393 preserves explicit provider-native project-agent skill references.
- PR #395 preserves executable modes in generated resource and plugin files.
- Both branches were reviewed from older baselines and are now conflicting with
  live `main` at `4ae1177a9ed1823cfb049643b09f923347f337a4`.
- The PRs are independent siblings based on `main`; neither may absorb the
  other's implementation.
- Trails PR #992 is downstream contract evidence. TRL-1272 remains gated on a
  merged and published SET-396 release; TRL-1274 remains gated on a merged and
  published SET-394 release. This goal stops before those downstream gates.

## Scope

- Reconcile Graphite topology from the main workspace.
- Detach only clean worker worktrees when needed to release branch captivity.
- Restack each PR independently on live `main`, resolve conflicts at its owning
  branch, regenerate owned outputs, and preserve reviewed behavior.
- Run focused and aggregate repository gates from each final tip.
- Run at least three independent local-review passes per final PR tip.
- Submit each PR through Graphite while draft, wait for fresh merge-ref CI,
  resolve all actionable human/bot feedback, and mark ready only when proven.
- Keep SET-394, SET-396, their PR bodies, affected Trails blocker issues, and
  this packet aligned with material state changes.

## Acceptance Criteria

For both PR #393 and PR #395:

- PR is open, non-draft, mergeable, and based independently on live `main`.
- Fresh PR-triggered merge-ref CI is green on the final submitted head.
- Focused tests and all applicable repository gates are green.
- At least three independent final-tip local reviews are recorded.
- No open P0, P1, or P2 finding exists.
- Every P3 is fixed or explicitly accepted with evidence.
- No unresolved GitHub review thread or review-bot error remains.
- Linear and PR descriptions/comments reflect current evidence.

## Constraints

- Preserve unrelated dirt and unexplained external commits.
- Do not delete worktrees or branches, force-overwrite remote work, hand-edit
  generated artifacts, weaken tests, or hide capability gaps downstream.
- Do not mutate HOME/provider configuration or globally activate Skillset.
- Do not merge, queue, publish, release, deploy, or start TRL-1272–TRL-1275.

## Decisions

- Completion horizon: `ready-pr`.
- Topology: single coordinator, two independent sibling Graphite branches, with
  bounded independent local-review lanes.
- Source-control, tracker mutations, conflict resolution, and final readiness
  decisions remain centralized in the main workspace.

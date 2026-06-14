# Output Safety and Loss Ledger Stack Plan

## Objective

Deliver a stacked Skillset hardening push that makes generated-output writes safer, makes lowering outcomes persistent and explainable, connects registry evidence to diagnostics where useful, and folds in tactical follow-up issues when they fit without compromising the core stack.

## Primary Issues

| Issue | Branch | Scope |
| --- | --- | --- |
| SET-19 | `set-19-protect-unmanaged-outputs-with-backups-and-revertable` | Protect unmanaged generated destinations with backup/revert provenance and target-side edit detection. |
| SET-79 | `set-79-write-adr-and-docs-for-lowering-outcome-vocabulary-and` | ADR/docs for lowering outcome and policy vocabulary. |
| SET-82 | `set-82-persist-lowering-outcomes-in-lock-and-build-report-surfaces` | Persist outcomes in lock/report surfaces with deterministic ordering. |
| SET-83 | `set-83-surface-lowering-outcomes-through-skillset-doctor-and` | Surface outcomes through `doctor` and `explain`. |
| SET-84 | `set-84-enforce-unsupported-lossy-and-degraded-policy-gates-from` | Enforce unsupported/lossy/degraded gates from structured outcomes. |
| SET-85 | `set-85-add-fixture-coverage-for-outcome-status-matrix` | Add representative fixture coverage for the outcome matrix. |
| SET-86 | `set-86-migrate-existing-warnings-and-reports-onto-outcome-codes` | Move clear lowering-fact warnings/reports onto outcome codes. |
| SET-72 | `set-72-write-adr-and-feature-docs-for-the-registry-and-capability` | Reconcile registry ADR/docs with already-landed implementation. |
| SET-76 | `set-76-connect-registry-entries-to-validation-and-diagnostic` | Add feature ids to representative diagnostics without rewriting every diagnostic. |
| SET-77 | `set-77-add-registry-drift-checks-for-docs-fixtures-and-support` | Add registry evidence drift checks. |
| SET-78 | `set-78-expose-feature-capability-inspection-through-authoring-cli` | Expose registry-backed capability inspection in authoring CLI surfaces. |

## Tail Issues

These are included if they fit naturally after the core stack. If they do not fit, leave a Linear comment explaining the deferral and why.

| Issue | Branch | Include When |
| --- | --- | --- |
| SET-55 | `set-55-refactor-runtime-hook-guardrails-into-first-class-skillset` | Include if the stack still has enough review capacity after safety/outcomes/registry work; it is a real feature with self-hosted rebuilds. |
| SET-54 | `set-54-design-richer-skillset-create-repository-bootstrap-flow` | Include if current create/init code shows a bounded implementation path. |
| SET-105 | `set-105-p3-add-generic-adapter-conformance-helper-over-registry` | Include if fixture outcome data makes the generic helper straightforward. |
| SET-106 | `set-106-p3-return-structured-drift-from-checkskillsetresult-instead` | Include if check/result plumbing is already being touched for SET-82/83. |
| SET-107 | `set-107-p3-normalize-degraded-support-reasons-across-registry-and` | Include with SET-84 if policy gating depends on reason-bearing degraded/lossy records. |
| SET-108 | `set-108-p3-exclude-configured-output-roots-from-deterministic` | Include if deterministic projection code is nearby and the edge-case test is bounded. |

## Stack Strategy

Start from `main`, keep one purpose per branch, and prefer the Linear-recommended branch names. Use Graphite if the repo state is healthy enough after sync/prune; otherwise use vanilla git branches and record the reason in `RETRO.md`.

Recommended order:

1. SET-19 safety base.
2. SET-72 and SET-79 docs/ADR reconciliation.
3. SET-107 if needed before outcome enforcement.
4. SET-82, SET-83, SET-84.
5. SET-85 and SET-86 verification/migration.
6. SET-76, SET-77, SET-78 registry diagnostics and inspection.
7. P3/tactical tail: SET-106, SET-108, SET-105, SET-55, SET-54 as capacity allows.

If implementation reveals a better dependency order, adjust the order and record the reason in `RETRO.md`.

## Verification

Run narrow tests after each branch. Before a branch is ready, run the smallest relevant subset plus `git diff --check`.

Before stack handoff or merge, run:

- `bun run skillset:build`
- `bun run skillset:check`
- `bun run skillset:lint`
- `bun run typecheck`
- `bun test`
- `bun run check`
- `git diff --check`

If generated output changes, inspect it and keep `.skillset/` as source truth.

## Review Loop

Run local subagent/code-review passes before finalizing the stack. Reviewers should score out of 5, report P0-P3 findings, and include prompt-to-fix text for actionable findings.

Fix all P0/P1/P2 findings. Fix reasonable P3 findings when the fix is bounded and improves the stack. File or update Linear issues for remaining true P3s instead of writing only a temporary note.

## Completion

The goal is complete only when:

- included issues are implemented or explicitly deferred with Linear comments;
- Linear state matches branch/PR/merge reality;
- local review loop is recorded in `RETRO.md`;
- checks pass or skipped checks are justified;
- PRs are merged to `main` cleanly, if the stack is submitted;
- the next beta version is cut if the merged stack changes package behavior;
- `RETRO.md` has a final state and this packet is archive-ready.

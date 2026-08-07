# Execution Plan: Trails Migration Capability Unblock

Date: 2026-08-07
Status: Active

## Current State

- Main used for both independent restacks:
  `4ae1177a9ed1823cfb049643b09f923347f337a4`.
- PR #393: non-draft at `568d090c8b0f6acbb724728da5a64444e3347040`,
  independently restacked, fresh CI green, `MERGEABLE` / `CLEAN`, hosted Codex
  P2 fixed/resolved, and three exact-tip reviews 5/5 clean. Final-head Bugbot
  attempts repeated the external usage-limit error; SET-396 is Ready to Merge.
- PR #395: non-draft at `0567db91d7e93ba9d803f06cf610fed1d4335e11`,
  independently restacked, fresh CI green, `MERGEABLE` / `CLEAN`, and its
  hosted Codex P2 is fixed/resolved. A bounded final-head Cursor Bugbot rerun
  repeated the external usage-limit error; Linear automation moved SET-394 to
  Ready to Merge, but the strict goal remains externally blocked.
- Worker worktrees remain present; neither was deleted or destructively cleaned.
- npm latest: `skillset@0.22.0`.

## Ordered Work

1. [complete] Validate packet and record preflight in `RETRO.md`.
2. [complete] Detach the clean SET-396 worker without deleting it; check out #393 in the
   main workspace and restack only that branch onto live `main`.
3. [complete] Resolve #393 conflicts, regenerate, run focused and broad gates, and obtain
   three independent final-tip reviews.
4. [complete] Commit packet/evidence on #393 as the first owning execution branch, submit
   draft, reconcile fresh CI/review/bot state, and mark ready only when proven.
5. [complete] Detach the clean SET-394 worker; return main workspace to live `main`, check
   out #395, and restack only that branch independently.
6. [complete] Resolve #395 conflicts, regenerate, run focused and broad gates, and obtain
   three independent final-tip reviews.
7. [complete] Submit #395 draft, reconcile fresh CI/review/bot state, mark ready only when
   proven, update SET-394/SET-396 and affected Trails blocker issues, and
   finalize `RETRO.md`.
8. [complete] Reopen the loop for fresh hosted Codex findings on both PRs; fix
   U+0085 validation on #393 and read-only mode-only repair on #395, preserving
   independent ancestry.
9. [complete] Re-attest both repaired tips with three independent reviews, full
   local gates, fresh merge-ref CI, resolved threads, and final-head bot state.
10. [blocked] Re-query GitHub and Linear, finalize the packet, and stop at the
    ready-for-approval boundary without merge, queue, release, or downstream
    work. Cursor Bugbot's external usage limit currently prevents the required
    zero-review-bot-error state.

## Branch Isolation Rules

- #393 contains provider-native-reference work only.
- #395 contains executable-mode work only.
- Never restack one onto the other or resolve a conflict by importing the other
  branch's implementation.
- Preserve the externally authored PR commits and prove their old/new ancestry
  around any Graphite rewrite.

## Review Matrix

- #393: contract/schema/provenance; runtime/render/rename; full branch diff.
- #395: mode propagation/writes; lock/hash/migration/restore; full branch diff.
- Every lane reports JSON, 5/5 clean or an explicit fix loop, on the final tip.

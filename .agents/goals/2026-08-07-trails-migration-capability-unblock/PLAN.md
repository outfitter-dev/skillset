# Execution Plan: Trails Migration Capability Unblock

Date: 2026-08-07
Status: Complete

## Current State

- Main used for both independent restacks:
  `4ae1177a9ed1823cfb049643b09f923347f337a4`.
- PR #393: non-draft, independently restacked, fresh CI green,
  `MERGEABLE` / `CLEAN`, zero threads/reviews/bot errors; SET-396 In Review.
- PR #395: non-draft at `fa0bb1843ea1d5fa88c3763f2dad6f1da0ad3375`,
  independently restacked, fresh CI green, `MERGEABLE` / `CLEAN`, zero
  threads/reviews/bot errors; SET-394 In Review.
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

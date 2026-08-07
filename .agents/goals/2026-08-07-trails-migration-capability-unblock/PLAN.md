# Execution Plan: Trails Migration Capability Unblock

Date: 2026-08-07
Status: In progress

## Current State

- Main workspace: clean `main` at `4ae1177a9ed1823cfb049643b09f923347f337a4`.
- PR #393: draft, head `05bc116dc45cef36a3861d805c6a3455abc0eabe`,
  `CONFLICTING` / `DIRTY`, three historical head checks green, zero threads.
- PR #395: draft, head `c4dbecc3b78d8194723d92c2d4ecc80b8d50af4b`,
  `CONFLICTING` / `DIRTY`, no hosted checks, zero threads.
- Worker worktrees are clean and own the two branches.
- npm latest: `skillset@0.22.0`.

## Ordered Work

1. Validate packet and record preflight in `RETRO.md`.
2. Detach the clean SET-396 worker without deleting it; check out #393 in the
   main workspace and restack only that branch onto live `main`.
3. Resolve #393 conflicts, regenerate, run focused and broad gates, and obtain
   three independent final-tip reviews.
4. Commit packet/evidence on #393 as the first owning execution branch, submit
   draft, reconcile fresh CI/review/bot state, and mark ready only when proven.
5. Detach the clean SET-394 worker; return main workspace to live `main`, check
   out #395, and restack only that branch independently.
6. Resolve #395 conflicts, regenerate, run focused and broad gates, and obtain
   three independent final-tip reviews.
7. Submit #395 draft, reconcile fresh CI/review/bot state, mark ready only when
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

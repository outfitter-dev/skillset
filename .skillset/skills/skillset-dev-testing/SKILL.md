---
title: Skillset Testing
description: Design, implement, or review Skillset compiler tests, internal fixtures, deterministic projection, adapter conformance, self-hosted checks, and external adoption evidence. Use when choosing a test tier, creating fake repositories, changing test infrastructure, or proving compiler and provider-output behavior.
version: 0.1.0
---

# Skillset Testing

## Choose The Evidence Level

1. Read `docs/adrs/0012-fixtures-tests-dogfooding-and-evals.md`, `docs/adrs/0019-deterministic-projection-and-adapter-conformance.md`, and `fixtures/README.md`.
2. Use an inline temp fixture for focused positive, negative, diagnostic, and lifecycle cases.
3. Add `fixtures/<case>/` only for a durable whole-repo case shared by tests or too large to read inline.
4. Use pinned external fixtures only for opt-in adoption fidelity evidence; turn discovered product gaps into ordinary focused regression tests.
5. Keep compiler fixtures, self-hosted dogfooding, deterministic `skillset test` declarations, provider runtime probes, and model-facing evals distinct.

Read [references/fixture-strategy.md](references/fixture-strategy.md) before adding a checked-in or Git-backed fixture, changing test sandbox behavior, or choosing a conformance lane.

## Protect The Sandbox

- Build Git-backed fixtures only with `scripts/test-helpers/git-remote.ts` under a proven disposable root.
- Preserve `HOME`; rely on repository verification entrypoints to isolate XDG roots and Git configuration.
- Never initialize, configure, or commit into an arbitrary temp path, linked worktree, shared Git directory, or the Skillset checkout.
- Never hand-edit generated fixture output to make a test pass.

## Verify Narrowly Then Broadly

- Run focused tests with `bun run test:focused -- <test-files...>`.
- Run `bun run conformance:determinism`, `bun run conformance:adapters`, or `bun run conformance:fast` when the compiler projection or provider contract changes.
- Keep `bun run conformance:external` opt-in and network-aware.
- Rebuild and check self-hosted output after `.skillset/` changes.
- Run `bun run check` before handoff and report any skipped slow or credentialed evidence explicitly.

---
description: Generated output merge safety records why generated files never line-merge, why locks stay JSON snapshots, and the invariants behind build repair and resolve.
---

# Generated Output Merge Safety

A half-merged generated file is the dangerous artifact: it looks valid, stages like a valid file, and corresponds to no source. Only a regeneration may produce a generated file. This page records the reasoning behind the merge policy, the lock format, `skillset build --repair`, and `skillset resolve`, so changes to any of them start from the trade-offs already settled (SET-598 to SET-601).

## Three categories, one policy each

| Category | Examples | Git `merge` attribute |
| --- | --- | --- |
| Generated snapshot | Provider trees, `plugins/*/**`, every `skillset.lock` | `-merge` (unset) |
| Append-only ledger | `.skillset/changes/*.jsonl` | `union` |
| Authored | Everything else tracked | unspecified |

Both strategies are built into git. A custom merge driver needs per-clone `git config`, so it would not apply in CI, fresh clones, or worktrees.

`-merge` makes git report the path as unmerged and leave the "ours" side on disk whole, with no conflict markers. The conflict survives as a signal and `skillset resolve` clears it by regeneration. Do not use `binary` instead: it also sets `-diff`, and generated files must still review as readable diffs.

`.gitattributes` can only express globs, so `bun run generated-merge-policy:guard` (`scripts/generated-merge-policy-guard.ts`) derives both sides. Every path a committed `skillset.lock` claims must resolve to `merge: unset`. Every other tracked path must not, except the ledger set, which reuses the change-stream guard's pathspec. Checking the authored direction is what caught `/plugins/**` claiming the authored `plugins/README.md`. It also caught `**/AGENTS.md` matching `docs/reference/features/agents.md` on case-insensitive macOS but not on Linux CI.

## Locks stay JSON snapshots

A JSONL lock with `merge=union` was investigated and rejected (SET-598). Two problems are fatal:

- `provenanceHash` (`packages/core/src/lock-provenance.ts`) is one SHA-256 over the whole document, so it differs on every pair of branches. A union merge always produces two header records.
- `union` is line-based. Two branches that change adjacent item lines, such as alphabetically neighbouring skills, merge "cleanly" into duplicated records. That is a silent corruption which rebase hooks never see, which is worse than a whole-file conflict that halts the rebase where `resolve` can fix it.

Making locks union-safe would need per-record provenance. That means a new lock schema with migration, a redesigned provenance and repair path, Workbench parser changes, and weaker tamper detection. `skillset.lock` is a public artifact, so that change needs its own ADR. Until then, locks have no `union` exception in the guard.

## Build repair invariants

`skillset build --repair` (SET-599) classifies each managed path three ways, treating the lock as the merge base. It compares the file on disk with the lock's recorded `outputHash`, and a fresh render with the same hash:

| File vs lock | Render vs lock | Meaning | Action |
| --- | --- | --- | --- |
| same | same | clean | nothing |
| same | differs | source changed | regenerate |
| differs | same | hand-edited output | never regenerate silently |
| differs | differs | both moved | refuse; require a human |

- Never use modification times. A rebase rewrites them wholesale.
- `outputHash` is recorded per lock item (a file group), not per file. A path whose bytes already equal the render is clean whatever the lock says. When a sibling is missing, the item hash cannot be recomputed, so repair preserves the item instead of guessing (`lockIncomparablePaths`).
- `--repair <path>...` narrows only the write, never the plan. Scope expands to whole lock items, and each lock is merged item by item, so a scoped repair leaves unrelated drift and lock entries untouched.

## Resolve invariants

`skillset resolve` (SET-600, `apps/skillset/src/resolve-conflicts.ts`) follows four rules:

- Authored conflicts block everything. Regenerating from source that still has conflict markers renders those markers into generated output and stages them. Resolve the authored side by hand first, then rerun `skillset resolve --yes`.
- Read locks only from the index: the stage-0 blob when unconflicted, and stage-2 and stage-3 blobs when conflicted. Never parse worktree marker soup or fall back to `HEAD`.
- Run every git call with `git -C <root>` and `gitSafeEnv()`, so hook-exported `GIT_DIR` cannot redirect a run in a linked worktree.
- Snapshot every conflicted generated path before materializing a side, and restore it if validation, the build, or staging fails.

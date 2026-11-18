---
description: Generated output merge safety records why generated files merge as ordinary text, how per-entry lock provenance keeps that merge equal to a fresh render, and the invariants behind build repair and resolve.
---

# Generated Output Merge Safety

A half-merged generated file is the dangerous artifact: it looks valid, stages like a valid file, and corresponds to no source. Git may text-merge generated output only because a clean merge of branches that changed different units equals the merged render, and a same-unit collision leaves conflict markers that lock readers reject; a conflicted generated file is only ever fixed by regenerating it. This page records the reasoning behind the merge policy, the lock format, `skillset build --repair`, and `skillset resolve`, so changes to any of them start from the trade-offs already settled (SET-598 to SET-601).

## Four categories, one policy each

| Category | Examples | Git `merge` attribute |
| --- | --- | --- |
| Generated snapshot | Provider trees, `plugins/*/**`, every `skillset.lock` | unspecified |
| Append-only ledger | `.skillset/changes/*.jsonl` | `union` |
| Pending ledger events | `.skillset/changes/events/*.jsonl`, one write-once file per mutation | unspecified |
| Authored | Everything else tracked | unspecified |

Pending event files are only ever added, and each name carries a timestamp and an event id, so branches never touch the same file and the default text merge suffices. `skillset release apply` folds pending files into `ledger.jsonl` and appends release/history records. `skillset change amend` and `skillset release amend` append directly to `amendments.jsonl` and `release-amendments.jsonl`, respectively. All these trunk streams use union; pending files are removed only by release folding. Non-amendment record IDs must be unique within a stream, and event IDs across the ledger and pending files. Amendment IDs name the amended record and may repeat; the last amendment in file order wins. Restack a branch that appended to any trunk stream so trunk remains an unchanged prefix. See [change-stream safety](../../reference/features/changes.md#merging-change-streams) for ordering and guard checks. Both strategies are built into git. A custom merge driver needs per-clone `git config`, so it would not apply in CI, fresh clones, or worktrees.

Generated output carries no merge attribute ([ADR-0045](../../adrs/0045-generated-state-merges-as-plain-text.md)). Until SET-769 it was marked `-merge`, which made git conflict every generated path whole on every local merge. GitHub's server-side merge and merge queue ignore merge attributes, so the attribute never helped there, and it made local merges disagree with GitHub. With per-entry lock provenance, each lock line belongs to one unit, so a text merge of branches that changed different units is the merged render; the plain-merge conformance test (`apps/skillset/src/__tests__/plain-merge-conformance.test.ts`) checks both merge directions and a restack under this repository's own `.gitattributes`. When both branches changed the same unit, git writes ordinary conflict markers, lock readers fail closed on them, and `skillset resolve` regenerates from the index stages.

`.gitattributes` can only express globs, so `bun run generated-merge-policy:guard` (`scripts/generated-merge-policy-guard.ts`) derives both sides. Every path a committed `skillset.lock` claims must resolve to `merge: unspecified`, so no `-merge` or `union` pattern creeps back over generated output. The ledger set, which reuses the change-stream guard's pathspec, must resolve to `union`, and every other tracked path to `unspecified`. Checking the authored direction is what caught `/plugins/**` claiming the authored `plugins/README.md`. It also caught `**/AGENTS.md` matching `docs/reference/features/agents.md` on case-insensitive macOS but not on Linux CI.

## Locks carry per-entry provenance

Locks stay one sorted JSON document per output root. Schema v5 (`packages/core/src/lock-provenance.ts`) splits provenance so that two branches changing different units change different lines:

- `headerHash` covers the top-level fields except `items` and `renderResults`. Those fields come from configuration and target topology, so it moves only when `skillset.yaml` or the selected targets change.
- Each `items[]` entry carries its own `provenanceHash` over the rest of that entry.
- `renderResults` are diagnostics, not authority, and stay unhashed.
- A lock is trusted exactly when the header hash and every item hash verify. A hand edit to an entry, or a leftover v4 `provenanceHash`, fails verification.

A v4 lock whose single document hash verifies is trusted for the move to v5, and the next `skillset build --yes` rewrites it.

Why not a JSONL lock with `merge=union` (SET-598): `union` is line-based. Two branches that change adjacent item lines, such as alphabetically neighbouring skills, merge "cleanly" into duplicated records, which is silent corruption. The v5 lock relies on the ordinary three-way text merge instead. Neighbouring entries still conflict when both sides change the lines next to each other, which halts the merge where `skillset resolve` can fix it.

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

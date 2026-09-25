---
id: 38
slug: change-ledger-append-order
title: Change Ledger Append Order Is Authoritative
status: accepted
created: 2026-09-22
updated: 2026-09-25
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 14, 15]
amends: [15]
---

# ADR-0038: Change Ledger Append Order Is Authoritative

## Context

ADR-0015 made `.skillset/changes/ledger.jsonl` the durable append-only event
stream and said derived release and pending state are folded from that stream.
It did not say how event time, append order, and Git's `merge=union` contract
interact when two writers or two branches both append.

That gap showed up as concrete damage. Refresh and ignore already took the
change-ledger directory lock, but add, reason, migrate, and release wrote the
same streams without it. A failed release restored a whole-file snapshot; a
successful concurrent append after that snapshot could disappear. The
change-stream guard then had to record seventeen exact historical timestamp
inversions, while repository guidance still said five, and every restacked
branch whose appended block predated trunk's tail added another. The growing
list is evidence that file order, timestamps, and union merge need one
explicit policy — and that a pairwise timestamp rule is the wrong check.

Existing committed history must not be sorted or rewritten. The streams stay
append-only JSONL.

## Decision

File order is the only fold order for change and release JSONL streams.

`readChangeLedger`, pending-fact readers, and `readLedgerReleaseState` walk
records top to bottom and let later records win. A record's position is the
sequence. `createdAt` and `appliedAt` are event time, not sequence. Global
chronological order is not an invariant.

### Live writers serialize on one owner-fenced mutation

Add, reason, migrate, refresh, ignore, and release take the same
owner-fenced ledger lock and hold it across read, plan, append, and rollback.
Only the current token holder can release that lock. An old owner must not
remove a successor lock.

Rollback removes only the JSONL records that transaction appended. It never
restores a whole-file snapshot of an append-only stream. Two concurrent
successful mutations therefore keep both record sets, and a failed release
cannot erase an unrelated writer's append.

New writers choose a timestamp that does not invert the current tail:
`max(now, tailTimestamp)`. Equal timestamps are allowed. This keeps live
appends guard-clean without pretending wall-clock order is the ledger.

### Union merge concatenates; it does not sort

`.gitattributes` declares `merge=union` for `.skillset/changes/*.jsonl`. Union
keeps both sides' appended lines. It can place an older appended block after a
newer tail. That is a merge-order fact, not a license to rewrite history.

The change-stream guard checks what union cannot: trailing newline, one JSON
object per line with an id and a parseable event timestamp, unique ids, the
`merge=union` attribute, and that trunk's stream is an in-order prefix of the
working copy.

The prefix check reads each stream at `git merge-base HEAD <trunk>` (trunk is
`scripts/git-trunk.sh`, normally `origin/main`) and requires every one of those
lines to appear unchanged, at the same position, in the working copy. A branch
may only add records after them. On failure the guard names the first
divergent line and the trunk record expected there.

This is the invariant file-order folding needs: existing order never changes.
It does not compare timestamps, so an appended block older than trunk's tail —
what union produces when a restacked branch lands after newer trunk records —
passes without an allowance. There is no allowlist. Never sort a stream to
clear a guard failure; restore trunk's records exactly and move this branch's
records after them.

## Consequences

### Positive

Derived release and pending state have one sequence: the bytes on disk.
Concurrent command writers share one lock and one rollback rule. The guard
enforces that sequence directly, so restacks no longer grow an exception list
and guidance no longer drifts from a count.

### Tradeoffs

Live writers pay for exclusive locking; `release apply` holds the lock across
its generated-output build, so a concurrent writer can wait up to its lock
timeout. The guard needs the trunk ref and history locally (CI checks out with
full depth) and fails loudly when the merge-base cannot be resolved. It no
longer catches a timestamp inversion inside a branch's own appended block;
that block's order is the writer's, and live writers stamp `max(now, tail)`.
Source draft, move, and
promote still plan a whole-file ledger update inside their own source-mutation
transaction; this decision does not replace that apply path.

### What This Does NOT Decide

Single-file JSON publication for `state.json` and other replaceable documents
is a separate atomic-write decision. Shared directory-lock machinery across
remote cache and the known-Skillsets index is a separate ownership decision.

## References

- [ADR-0015: Reason-Only Change Ledger and Derived State](0015-reason-only-change-ledger-derived-state.md) -
  append-only event vocabulary and derived-state boundary this decision
  narrows.
- [ADR-0014: Source Change, Release, and Dependency Provenance](0014-source-change-release-provenance.md) -
  committed change and release model.
- [Merging Change Streams](../reference/features/changes.md#merging-change-streams) -
  author-facing union-merge and guard contract.

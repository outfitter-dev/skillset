# SET-598 — make `skillset.lock` merge-safe

https://linear.app/outfitter/issue/SET-598/skillsetlock-conflicts-on-every-stacked-rebase-treat-it-as-a-snapshot

## Stack position

This investigation is stacked directly above SET-601, after the generated-output
repair branches SET-599 and SET-600. That ordering is load-bearing: SET-601
already makes lock conflicts whole-file and marker-free, while SET-600 repairs
them by regeneration. This branch evaluates whether changing the lock format
would improve on that completed path.

## Original proposal under evaluation

1. **Emit the lock as JSONL.** One `items[]` record per line, sorted
   deterministically by `outputPath`. Header fields (`buildMode`, `features`,
   `generatedBy`) move to their own record or file so they are not rewritten by
   every item change.
2. **Add the attribute.** `*.skillset.lock merge=union` in `.gitattributes`,
   matching the change-stream entry and its reasoning: `union` is built in, so
   unlike a custom merge driver it needs no per-clone `git config` and therefore
   applies in CI, fresh clones, and worktrees.
3. **Add a guard.** Union can emit duplicate `outputPath` records and cannot see
   staleness. Mirror `change-stream:guard`: validate the JSONL, reject duplicate
   `outputPath`, and fail on drift against a fresh build.

Out of scope: drift detection. It already exists — `skillset:check:outputs` in
pre-commit, `skillset:check:ci` in pre-push and CI.

## Readers to update

`skillset.lock` is read in at least `packages/core/src/build.ts`,
`packages/core/src/source-readiness.ts`, `packages/core/src/output-safety.ts`,
`packages/workbench/src/parser.ts`, `scripts/conformance/standards/run.ts`,
`scripts/provider-validation-artifacts.ts`, and `scripts/docs/golden-path.ts`.
Confirm the full set before changing the format.

## Principle

Ledgers are append-only and merge with `union` plus a uniqueness guard.
Snapshots are full-state and derived; they cannot merge at all, only regenerate.
A derived file appearing in a conflict set is the defect — the fix is making it
structurally unable to conflict, not choosing a better side.

---

# Finding: the proposed format change cannot work as specified

**No runtime code lands on this branch.** Investigated 2026-09-18. The JSONL +
`union` design is not implementable as written, and the reason is a lock field
the issue does not mention. The evidence below supports retaining the snapshot
format and the `-merge` policy established by SET-601.

## The blocker: `provenanceHash`

Every `skillset.lock` carries a `provenanceHash` — a SHA-256 over the *entire*
lock document except itself (`packages/core/src/lock-provenance.ts`). It is one
scalar. Any change to any item rewrites it.

Measured on two branches cut from one base, A editing only skill `alpha` and B
editing only skill `beta`, exactly the scenario the issue says should stop
conflicting. The only top-level fields that differ between A and B are:

* `items` — as expected, and
* `provenanceHash`.

`renderResults`, `standardProfileEvidence`, `selectedTargets`, `features`, and
the rest are identical. So the header *would* be stable — except for
`provenanceHash`, which is never stable.

## What union actually produces

The issue's design was built literally: header record on line 1, one item record
per line sorted by `outputPath`, `merge=union`, then A rebased onto B.

```
REBASE CLEAN (no conflict)
header records: 2 (must be 1)
item records  : 4
  alpha/SKILL.md: 2 record(s)
  beta/SKILL.md: 2 record(s)
```

The rebase does go clean — that half of the promise holds. But the lock is
corrupt, and **it merged silently**. That is worse than today's behaviour, not
better: a hard conflict halts the rebase at the moment the problem is created
and `skillset resolve` clears it in one command, whereas a silently corrupt lock
rides forward to whatever gate catches it later. Rebase does not run pre-commit
hooks, so the nearest gate is pre-push or CI.

## Isolating the two failure modes

Item records alone, header in a separate file, 20 items, one changed per side:

| changed items | merge | result |
| --- | --- | --- |
| `skill-02` vs `skill-15` (far apart) | clean | 20 records, no duplicates ✅ |
| `skill-07` vs `skill-08` (adjacent lines) | clean | 22 records, both duplicated ❌ |

So:

1. **The core intuition is right** for items whose lines are far apart. Those
   merge cleanly with no union needed at all.
2. **Adjacent item lines silently duplicate.** `union` is line-based and has no
   notion of "the same record, updated"; two changed lines close enough to fall
   in one hunk are concatenated, not reconciled. Alphabetically adjacent skills
   are exactly the common case.
3. **The header duplicates unconditionally,** because `provenanceHash` always
   differs. Moving the header to its own file does not help: that file then
   conflicts on every cross-branch merge, so the rebase halts anyway and nothing
   is gained.

Point 3 is fatal on its own. Point 2 means the guard would convert most
remaining cross-branch merges into guard failures at commit or push time, which
is later and less actionable than the rebase halt it replaces.

## What it would take to do properly

Make provenance per-record: each JSONL line carries its own hash, so a union
merge preserves individually valid lines and the duplicate-`outputPath` guard
becomes the whole-set check. That is coherent, and it is a much larger change
than the issue describes:

* a new lock schema version alongside migration for v1–v3;
* redesigning `lock-provenance.ts` and every caller of
  `hasValidLockProvenance` / `withLockProvenance`, including
  `classifyLockProvenance` and the `managedLockRepairPaths` repair path;
* the readers listed above, plus `@skillset/workbench`'s parser;
* regenerating all 108 managed outputs;
* and a deliberate weakening of tamper detection from whole-document to
  per-record.

`skillset.lock` is also a public artifact that adopters and Workbench consume,
so this is a compatibility decision, not an internal refactor.

## Recommendation

**Do not change the lock format yet.** SET-599 through SET-601 changed the
arithmetic this issue was filed against:

* SET-601 makes a lock conflict marker-free — a whole-file conflict, never
  marker soup.
* SET-600 clears it with one `skillset resolve`, correct by regeneration, which
  is the exact manual procedure the issue's "Immediate workaround" describes.
* SET-599 guarantees the regeneration can actually restore what is missing.

The symptom that opened this issue — "the move was aborted, the stack could not
be linearized" — is fixed. What remains is a halt per rebase step, not a
failure. If that residual cost still hurts after the stack lands, per-record
lock provenance deserves its own ADR and its own issue.

## Errors in the issue

* **Proposal point 2's glob does not match anything.** `*.skillset.lock` matches
  a file *named* `<something>.skillset.lock`; the files are named
  `skillset.lock`. The correct pattern is `**/skillset.lock`, which SET-601
  landed with `-merge`.
* The "Underlying principle" section contradicts proposal point 1. It says
  snapshots "cannot be merged at all, only regenerated" and that "a derived file
  should never arbitrate a merge" — and then proposes `union`, which is a line
  merge arbitrated by a derived file. The principle is the correct half.

## Policy retained deliberately

`generated-merge-policy:guard` (SET-601) requires `merge` to resolve to `unset`
for every generated snapshot, including every `skillset.lock`. Locks have no
`union` exception. Append-only change streams are the only files allowed to use
`merge=union`.

---
title: Fix Skillset Generated Output
description: Diagnose and clear generated-output trouble in a Skillset repository — drift reported by check, a missing or hand-edited generated file, a conflicted path under a managed output root, or a halted rebase or merge. Routes to skillset resolve, skillset build --repair, and skillset check --only outputs. Use when a generated file or a skillset.lock differs from source, is missing, or is conflicted. Do not use for conflicts in authored source.
version: 0.4.0
---

# Fix Skillset Generated Output

Skillset commits its generated output. Those files are derived: their content is a
function of authored source. A conflict or a diff in one of them carries no
information, because the correct content is always whatever regenerating produces.

Never hand-edit a generated file, and never hand-merge one.

## Run the repository's own compiler

Run `skillset --version` and compare it against the `version` in the repository's
`package.json`. When they differ, a globally installed `skillset` is shadowing the
one under test, and its answers describe a different compiler.

- In a repository that builds `skillset` itself, invoke it through the repository:
  `bun ./apps/skillset/src/cli.ts <command>`, or the `bun run skillset:*` scripts.
- Everywhere else, the installed binary is correct.

This is not hypothetical. A stale 0.26.1 binary reporting `build is blocked` on a
repository whose own compiler restores the file correctly is what produced the
false premise behind SET-599.

## Decide whether the path is generated

Do this first. It determines everything that follows.

1. Run `skillset explain <path> --root .`. It reports ownership and provenance, and
   labels a derived path `(generated)`.
2. When `explain` is unavailable, treat a path as generated if it appears as an
   `outputPath` or in `files[]` of a `skillset.lock`, or is a `skillset.lock`.
3. When the path is authored source, this skill does not apply. Resolve it as
   ordinary source.

## Read the verdict

`skillset build --repair` and `skillset resolve` both print one line per affected
path: the verdict, then the action. Read those words rather than re-deriving them.

| Verdict | What it means | What happens |
| --- | --- | --- |
| `clean` | The file already equals what source produces. | Nothing. |
| `output-missing` | A managed file is absent. | Restored. No edit can be lost. |
| `source-ahead` | Source moved; the output is stale. | Regenerated. |
| `output-obsolete` | The lock claims it but source no longer produces it. | Removed. |
| `output-edited` | The generated file was edited; source was not. | Preserved, not overwritten. See `## Recover a misdirected edit`. |
| `lock-untrusted` | The lock records no verdict this repair can rely on. | Preserved. The fault is the lock, not the output. See `## Rebuild an untrusted lock`. |
| `diverged` | The generated file **and** its source both moved. | Refused. See `## Escalate`. |

The verdicts come from a three-way comparison against the `outputHash` the lock
recorded for the last build — the file on disk, the lock, and what a fresh render
would produce.

MUST NOT use file modification times to decide any of this. A rebase or a checkout
rewrites mtimes across the whole tree, so in the situation where drift matters
most, every file appears equally fresh.

`outputHash` is recorded per lock *item*, which is a group of files, so a single
edited file marks its whole group. A path whose bytes already equal the render is
reported `clean` regardless, because writing it would change nothing.

## Clear a conflict during a rebase or merge

1. Run `skillset resolve --root .` to see the partition without writing anything.
2. When it names **authored** conflicts, it stages nothing and exits non-zero.
   Resolve those files, `git add` them, then return to step 3. Regenerating from
   source that still carries conflict markers would render those markers into
   generated output.
3. When it reports paths **edited by hand on one side of the conflict**, it
   stages nothing and exits non-zero. Follow `## Recover a misdirected edit` for
   each named path, commit the source change, then return to step 3.
4. Run `skillset resolve --root . --yes`. It repairs the generated paths and stages
   them.
5. When it exits zero, continue the operation: `gt continue` under Graphite,
   otherwise `git rebase --continue`.
6. When it reports a `diverged` path, follow `## Escalate`.

A conflicted file on disk represents neither side, so the verdict table has no
baseline there. `skillset resolve` instead checks each conflict side against the
lock that side committed, and refuses when either disagrees. MUST NOT resolve
such a path by taking a side. The pre-rebase commit still holds the edit; recover
it from there.

`skillset resolve` reads the conflicted locks from conflict stage 2, then stage 3,
then `HEAD`, so a lock carrying markers does not need fixing by hand first. It
stages only paths it classified as generated, and MUST NOT be used to stage
authored source.

## Repair drift outside a conflict

Use this when `skillset check` reports drift and no rebase or merge is in progress.

1. Run `skillset build --repair --root .`. It classifies every managed path against
   filesystem reality and prints a verdict for each that needs action.
2. When every verdict is `clean`, `output-missing`, `source-ahead`, or
   `output-obsolete`, run `skillset build --repair --root . --yes`. It restores,
   regenerates, and removes.
3. When any verdict is `output-edited`, it writes nothing. Follow
   `## Recover a misdirected edit` for each named path, then return to step 1.
4. When any verdict is `lock-untrusted`, it writes nothing. Follow
   `## Rebuild an untrusted lock`, then return to step 1.
5. When any verdict is `diverged`, it writes nothing. Follow `## Escalate`.
6. Run `skillset check --only outputs --root .`. Continue only when it passes.

`--repair` restores a deleted managed file byte-identically and leaves the lock
untouched when nothing else changed.

`skillset build --repair --discard-edits` overwrites a hand-edited output instead
of preserving it. Use it only after the edit has been carried into source, or when
the edit is confirmed unwanted. It cannot override a `diverged` verdict.

## Rebuild an untrusted lock

A `lock-untrusted` verdict means the lock's own integrity check failed, so the
repair cannot tell a stale output from a hand-edited one. The generated file is
not necessarily wrong, and there is probably no misdirected edit to recover.

MUST NOT treat this as `output-edited`. MUST NOT go looking for an edit to port
into source.

1. Confirm the generated files themselves are what you expect:
   `git status` and `git diff` over the named paths.
2. Rebuild so the lock is regenerated with valid provenance:
   `skillset build --root . --yes`.
3. Rerun `skillset build --repair --root .`. The verdicts should now be real.
4. When the lock was tampered with deliberately, or step 2 does not clear it,
   stop and report that. A lock that will not rebuild is a compiler problem, not
   a content problem.

## Recover a misdirected edit

Do this for every `output-edited` path. When the generated file changed and its
source did not, the edit was almost certainly aimed at the wrong file. The intent
is usually right and the target is wrong.

MUST NOT discard the edit. MUST NOT leave the edit in the generated file.

1. Capture the edit: `git diff -- <generated-path>`, or read the backup Skillset
   wrote under `.skillset/snapshots/` before any overwrite.
2. Find the authoring source: `skillset explain <generated-path> --root .`.
3. Apply the equivalent change to that source file.
4. Regenerate: `skillset build --root . --yes`.
5. Confirm the generated file now contains the intended change, and that
   `skillset check --only outputs --root .` passes.
6. When the change cannot be expressed in source, stop and report that. It means
   either the source format lacks the capability or the change does not belong in
   generated output.

### Which row is it?

> **`source-ahead`.** A skill's source gained a new section. The generated
> `SKILL.md` no longer matches what the compiler would emit, and nobody touched the
> generated file. Regenerate.

> **`output-edited`.** Someone fixed a typo directly in
> `.agents/skills/<name>/SKILL.md`. The source still says what it always said.
> Port the typo fix to source, then regenerate.

> **`lock-untrusted`.** Nobody touched the generated file at all; a merge or an
> edit damaged `skillset.lock`, so its recorded hashes no longer verify. There
> is no edit to port. Rebuild the lock.

Both look identical in `git status` — one modified generated file. Only the lock
comparison separates them, which is why the verdict is worth reading rather than
guessing.

## Escalate

Stop and hand back when either holds:

- A path's verdict is `diverged`: the generated file was edited **and** its source
  changed.
- A change cannot be expressed in authored source.

Report the exact paths and which condition applies. MUST NOT guess which side to
keep, and MUST NOT resolve the path by picking one.

## Verify before finishing

- Run `skillset check --only outputs --root .`. It MUST pass.
- Confirm no generated file contains a conflict marker. Managed output roots are
  marked `-merge` in `.gitattributes`, so git conflicts them whole rather than
  writing markers into them; a marker in one means something bypassed that.
- Confirm no authored source was staged by a resolve step that should only have
  touched generated output.

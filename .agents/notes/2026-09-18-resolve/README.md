# SET-600 — `skillset resolve`

https://linear.app/outfitter/issue/SET-600

Blocked by SET-599: resolve cannot repair what build cannot restore.

## What it does

1. Read the conflicted set from `git diff --name-only --diff-filter=U`.
2. Partition into generated and authored paths. A path is generated when it
   appears as an `outputPath` or in `files[]` of a `skillset.lock`, or is a lock.
3. Classify each generated path by the SET-599 verdict table; repair what is safe.
4. Stage what it repaired.
5. Print the authored conflicts that remain; exit non-zero if any do.

## Two implementation notes learned the hard way

- Read the lock from a parseable source. During a conflict the working-tree lock
  carries markers and will not parse. Fall back to conflict stage 2, then stage 3,
  then `HEAD`.
- It must work inside a git worktree, not only the primary checkout. The stack
  that motivated this has 13 worktrees, and `gt restack` silently skips any branch
  checked out in another one.

## Built, and one correction to the spec

Verified 2026-09-18 against real rebases, including inside a linked worktree.

### `resolve` refuses to repair while authored source is still conflicted

The issue's step order — classify and repair generated paths, *then* print the
authored conflicts that remain — is wrong, and the first implementation that
followed it literally produced exactly the artifact SET-601 calls the dangerous
one. Two branches editing the same skill conflict in both the source and its
outputs. Repairing first regenerates from source that still carries conflict
markers, so the markers are rendered *into* the generated file and staged:

The generated `SKILL.md` came out carrying git's own `HEAD` / `8d3a15b (B)`
marker pair around the two bodies, and `resolve` staged it. A file that looks
valid, stages like a valid file, and corresponds to no source. (The markers are
not reproduced literally here: the pre-commit whitespace gate rejects a commit
containing them, which is the same instinct this note is about.)

So authored conflicts are now checked first and block everything: `resolve`
names them, stages nothing, and exits non-zero. The workflow is resolve the
authored conflict by hand, then rerun `skillset resolve --yes`. That still
satisfies the issue's stated requirements — authored conflicts are printed and
the exit is non-zero — it just refuses to do generated work that source has not
authorized yet.

### How the conflicted state is made classifiable

The verdict table compares whole files, and a conflicted path on disk is marker
soup that represents neither side. Before classifying, `resolve` materializes
every conflicted generated path from conflict stage 2 (ours), falling back to
stage 3 and then `HEAD`, and deleting the file when no side has it. Locks are
materialized first, because the lock inventory is what decides which other paths
are generated at all.

### Worktree safety

Every git call goes through `git -C <root>` with `gitSafeEnv()`, which strips
`GIT_DIR`, `GIT_WORK_TREE`, and friends. Without that a `resolve` invoked from a
pre-commit hook would operate on the hook's repository instead of the worktree.
Paths are rewritten from `rev-parse --show-toplevel` to the Skillset root, so a
workspace in a repository subdirectory also works.

### Staging scope

`resolve` stages the conflicted generated set plus whatever the repair wrote or
deleted, intersected with the lock inventory. The build writes a whole
consistent projection, so leaving the non-conflicted part of that write unstaged
would hand `git rebase --continue` a dirty tree; every path staged is still
confirmed generated first.

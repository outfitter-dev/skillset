# SET-600 — `skillset resolve`

https://linear.app/outfitter/issue/SET-600

Blocked by SET-599: resolve cannot repair what build cannot restore.

## What it does

1. Read the conflicted set from `git diff --name-only --diff-filter=U`.
2. Build a read-only inventory from both sides' locks. A path is generated when
   either side claims it in a lock, or when it is a lock itself.
3. Refuse before mutation when authored conflicts or hand-edited generated
   paths remain.
4. Without `--yes`, report the plan and leave the index and worktree unchanged.
5. With `--yes`, snapshot the conflicted generated paths, materialize one
   coherent side, run the whole-projection repair, and restore the snapshots if
   validation blocks, the build throws, or Git cannot stage the repair.
6. Stage the conflicted generated set plus generated paths the repair wrote or
   deleted, including newly introduced outputs.

## Two implementation notes learned the hard way

- Read locks only from the index. An unconflicted lock is the stage-0 blob;
  conflicted locks use their matching stage-2 and stage-3 blobs. Never parse
  worktree marker soup or fall back to mutable worktree/`HEAD` lock JSON.
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

### How the conflicted state is made repairable

The worktree conflict is marker soup that represents neither side. Inventory is
therefore read directly from the stage-0 index blob for unconflicted locks and
from the stage-2 and stage-3 lock/payload blobs for conflicts; worktree bytes
are never trusted as provenance. Only a confirmed repair materializes files,
using the selected lock and payload side together. Before doing so, `resolve` captures
the exact prior bytes, mode, absence, or symlink target for every conflicted
generated path. A blocked or thrown repair restores that state, and
materialization removes a path before writing so it never follows a worktree
symlink into an unrelated target. Parent components are checked too; resolve
refuses a generated path routed through a symlinked directory. Missing-file
snapshots also remember which parent directories did not exist, so rollback
does not leave empty generated directories behind.

### Worktree safety

Every git call goes through `git -C <root>` with `gitSafeEnv()`, which strips
`GIT_DIR`, `GIT_WORK_TREE`, and friends. Without that a `resolve` invoked from a
pre-commit hook would operate on the hook's repository instead of the worktree.
Paths are rewritten from `rev-parse --show-toplevel` to the Skillset root, so a
workspace in a repository subdirectory also works. Conflict, lock, index,
tree, and blob reads fail closed: only a successful empty query means absence.
Index and tree entries carry their exact blob object and regular-file mode;
unsupported symlink or gitlink modes are refused rather than normalized.

### Staging scope

`resolve` stages the conflicted generated set plus whatever the repair wrote or
deleted. Existing paths are confirmed by the lock inventory; paths newly
introduced by the merged source are confirmed by the build's own generated
write summary. The build writes a whole consistent projection, so leaving the
non-conflicted part of that write unstaged would hand `git rebase --continue` a
dirty tree. Before that build, resolve loads Core's resolved input inventory and
refuses unstaged or untracked compiler inputs under `skillset.yaml`, the source
root, explicit `repo:` feature files or trees, and `repo:` package-support
manifests. Unrelated notes and receipts remain outside the gate. A read-only
preview identifies every path the build may touch so a later staging failure
can restore the whole write set.

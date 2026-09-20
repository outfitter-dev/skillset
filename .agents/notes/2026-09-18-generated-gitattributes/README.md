# SET-601 — do not line-merge generated outputs

https://linear.app/outfitter/issue/SET-601

A half-merged generated file is the dangerous artifact here. It looks valid, it
stages like a valid file, and it corresponds to no source. Only a regeneration
should ever produce a generated file.

Mark the managed output roots so git does not attempt a line-level merge on them.
Follow the reasoning already in `.gitattributes` for change streams: prefer a
built-in strategy over a custom merge driver, because a driver needs per-clone
`git config` and therefore does not apply in CI, fresh clones, or worktrees.

Confirm the exact attribute against current git behaviour before landing. The
intent is "do not line-merge" with no per-clone configuration.

## Verified, and what the exact attribute turned out to be

`-merge`, confirmed empirically against git 2.55.0 rather than from
documentation. Two branches editing the same line of a covered file, rebased:
git lists the path as unmerged and leaves the "ours" side on disk **whole**,
with no markers. The conflict survives as a signal; the marker soup never
appears. `diff` is unaffected, which is why `binary` (`-diff -merge -text`) is
the wrong tool — generated files should still review as readable diffs.

No per-clone `git config`, so it applies in CI, fresh clones, and worktrees.

SET-601's own verification section, run end to end: the conflicted generated
`SKILL.md` contained zero markers, the conflicted authored source contained
them (a conflict that carries information), and `skillset resolve --yes`
cleared the generated set after the authored one was fixed by hand.

## "Derived from configuration rather than hardcoded"

`.gitattributes` only speaks globs, so it cannot literally derive anything. The
managed set is also not tidy: besides the five bulk roots, the locks claim
`.claude/settings.json`, `.codex/hooks/hooks.json`, `.cursor/rules/fixtures.mdc`,
`.skillset/plugins/skillset/CHANGELOG.md`, three directory-local `AGENTS.md`
files, and a nested example workspace under `examples/first-author/`.

So the requirement is met by inversion: the globs stay static, and
`bun run generated-merge-policy:guard` reads the committed `skillset.lock`
files, resolves `git check-attr merge` for every path they claim, and fails if
any is not `unset`. The locks remain the source of truth; the patterns only have
to keep up with them, and they cannot silently fall behind.

The guard also checks the other direction, against a small list of known
authored paths — and earned its place immediately. The first draft used
`**/plugins/skillset/**`, which also matches the authored `.skillset/plugins/`
**source** tree. The guard caught it; the pattern is now anchored as
`/plugins/**`.

## Sequencing note for SET-598

Locks remain `-merge` here because a lock is a generated snapshot like any
other output. The following SET-598 investigation tested an append-only JSONL
format with `merge=union` and rejected it: whole-document provenance makes the
header change on every update, while adjacent item edits can silently duplicate
records. The guard therefore requires `unset` for locks too; it has no union
exception for generated snapshots.

## Not done

`skillset init` does not scaffold these attributes into adopter repositories.
This branch is scoped to this repository, per the issue. Worth a follow-up:
every source-first repo that commits generated output has the same exposure.

## The guard derives both sides now

The first version checked the generated side exhaustively from the locks but
checked the authored side against a four-entry hardcoded list. That asymmetry
was the weak point, and replacing the list with derivation immediately found two
real over-reaches the list could never have caught:

* **`/plugins/**` claimed the authored `plugins/README.md`.** It is
  `/plugins/*/**` now, which covers each generated bundle without claiming the
  README beside them.
* **`**/AGENTS.md` claimed `docs/reference/features/agents.md`.** `core.ignorecase`
  is true on APFS and git matches attributes case-insensitively when it is, so
  the pattern matched a lowercase authored file — **on macOS but not on Linux
  CI**. The docs tree is now excluded; it is owned by `scripts/docs.ts` and
  checked by `bun run docs:check`, so Skillset's merge policy does not apply
  there.

The model is three categories with one policy each: `generated-snapshot`
(`-merge`, including locks), `append-only-ledger` (`union`), `authored`
(`unspecified`). The
generated set is derived from the locks, the ledger set reuses
`CHANGE_STREAM_PATHSPEC` from the change-stream guard rather than restating it,
and authored is everything else tracked. Nothing is enumerated.

Each narrowing exception in `.gitattributes` is safe precisely because the guard
checks the other direction: excluding `docs/` cannot hide a generated file,
because a lock-claimed path under `docs/` would fail as a generated path that
merges normally.

Cost at this repository's size: 1257 tracked files resolved in about 20 ms.

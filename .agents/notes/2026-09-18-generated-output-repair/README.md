# SET-599 — `skillset build --repair`

https://linear.app/outfitter/issue/SET-599

The spec lives in the issue. This note exists so the branch carries its own
pointer and the stack reads correctly without Linear access.

## The defect, in one line

skillset can detect a missing or altered generated output but cannot repair one.
`build`, `build --all`, and `update` all decline to recreate a deleted managed
file; `check --only outputs` reports it immediately. `build` trusts the lock,
`check` trusts the disk, and `build` is the one that is wrong.

## The diagnostic

The lock is a merge base. `outputHash` records what was generated last time, so
drift is a three-way comparison:

| file vs lock | would-generate vs lock | meaning | action |
| --- | --- | --- | --- |
| same | same | clean | nothing |
| same | differs | source changed | regenerate |
| differs | same | hand-edited output | never regenerate silently |
| differs | differs | both moved | refuse; require a human |

Do not use modification times. A rebase rewrites them wholesale, so in the exact
situation where drift matters, every file looks equally fresh.

## Correction: the premise was stale

Re-verified 2026-09-18 before implementing, at `8bac92610` on `main`.

**`build` already restores a deleted managed output.** Delete
`.agents/skills/use-skillset/SKILL.md` and run the repo's own compiler —
`bun ./apps/skillset/src/cli.ts build --root . --yes`, which is what
`bun run skillset:build` invokes — and it reports
`managed output is missing and will be regenerated`, writes the file back
byte-identically, and leaves the lock alone. `diagnoseMissingManagedOutputs` in
`packages/core/src/build.ts` has covered this since `3d2555748`.

The issue's reproduction was run against the **globally installed `skillset`
0.26.1** on `PATH`, not the repo's 0.27.0 source. The old binary does not
understand the current output topology; it reports
`build is blocked; no generated files were written`, which is a refusal rather
than the "reports success, writes nothing" the issue describes.

Two further claims did not survive either:

* **`build --all` does not rewrite `buildMode`.** Scope point 4 and the stack's
  hard constraint both assume it does. The lock still reads
  `"buildMode": "updated"` after `build --all --yes`, and the tree stays clean.
* **Row 3 was not entirely unhandled.** `build --yes` already backs a
  hand-edited output up before overwriting it. What was missing is refusing to
  overwrite it at all without confirmation.

## What was actually missing

Surfacing the classification as a verdict and acting on it:

* **The "render vs lock" axis did not exist.** `editedPaths` gave "file vs
  lock"; nothing compared a fresh render against the lock's recorded
  `outputHash`. Rows 3 and 4 were therefore indistinguishable — both surfaced as
  `diff.changed ∩ editedPaths` and both were silently overwritten.
* No per-path verdict, in prose or under `--json`.
* No way to refuse.

## Granularity, learned while building it

`outputHash` is recorded per lock **item** — a group of files — not per file.
So one edited file drags every untouched sibling in its item into the drift
evidence, and deleting one file makes the whole item's hash unrecomputable.

Two consequences, both load-bearing:

* A path whose bytes already equal the render is `clean` whatever the lock says.
  Writing it would change nothing, so nothing is at stake. Without this
  short-circuit, deleting `use-skillset/SKILL.md` reports its untouched
  `LICENSE.txt` sibling as hand-edited.
* When a sibling is absent the item hash cannot be recomputed at all.
  `lockIncomparablePaths` records that, and a repair preserves rather than
  guesses.

## Scope point 5

`--repair <path>...` scopes the write, not just the gate. The plan is still
computed over the whole projection — every verdict, diff entry and backup — and
only the write is narrowed, so nothing outside the named paths is touched.

Two details make that correct rather than merely narrower. Scope expands to
whole lock items, because `outputHash` covers a file group and writing half an
item would record a hash for bytes that were never written. And each lock is
merged rather than rewritten: in-scope items take their fresh entry, everything
else keeps the entry it already had, with provenance recomputed over the result.

So a scoped restore leaves the lock byte-identical, and a scoped repair beside
unrelated source drift leaves that drift alone.

The first implementation scoped only the gate, and needed a paragraph of
explanation for what the flag did not do. That was the tell: the flag was wrong,
not the documentation.

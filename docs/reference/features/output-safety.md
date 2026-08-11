---
description: Skillset output safety distinguishes managed output, protects neighboring files, and restores reversible backups.
---

# Output Safety

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `output-safety` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Output safety uses `skillset.lock` ownership to protect hand-authored files near [generated output](../../glossary.md#generated-output). There is no author-facing configuration key: the current [projection](../../glossary.md#projection), prior locks, on-disk bytes, and Unix modes determine whether a write is safe or needs a reversible backup.

## Ownership Cases

| Case | Behavior |
| --- | --- |
| Unmanaged neighbor inside an output root | Diff, output check, and stale cleanup ignore it |
| Unmanaged file at an exact [destination](../../glossary.md#destination) Skillset must write | Confirmed build backs it up, warns, then replaces it |
| Managed generated file edited since the last lock | Confirmed replacement or deletion backs it up first |
| Managed file missing | Plan warns and a confirmed build regenerates it |
| Corrupt lock | Build and output inspection fail before making ownership decisions |

[Workspace](../../glossary.md#workspace)-managed project files, plugin output, standalone skills, and generated changelogs are recorded in the root or nearest generated `skillset.lock`. Skillset never claims an entire directory merely because generated files live there.

## Preview Before Writing

```bash
skillset diff
skillset build
skillset build --yes
```

An unconfirmed build writes nothing. A confirmed build prepares recovery snapshots before replacing a collision or target-side edit. `compile.build: updated` changes missing, changed, or stale managed files; `all` selects every configured generated file. Neither deletes unmanaged neighbors.

`--isolated` applies the same rules inside the logical `.skillset/cache/latest/` mirror without touching live output roots. The generated [`build`](../cli/build.md), [`diff`](../cli/diff.md), and [`restore`](../cli/restore.md) pages own exact syntax.

## Choose the Recovery Path

| Symptom | Action |
| --- | --- |
| Managed file is missing | Preview and confirm a build |
| Generated edit should be discarded | Preview `skillset reconcile <path> --use source`, then confirm |
| Clean generated body edit should become source | Preview `skillset reconcile <path> --use output`, then confirm if eligible |
| Unmanaged collision was replaced | Inspect the reported backup and preview restore |
| Lock is corrupt | Stop; repair or regenerate ownership evidence from trusted source |
| Generated changelog wording is wrong | Use `change reason`, `change amend`, or `release amend`, not reverse patching |

[Reconciliation](source-suggestions.md) owns source/output conflict direction. [Troubleshooting](../../troubleshooting.md) routes from the observed symptom.

## Restore a Backup

```bash
skillset restore --list
skillset restore <backup-id>
skillset restore <backup-id> --yes
```

Backups live under `.skillset/snapshots/<backup-id>/` with a schema-versioned manifest and per-run bare Git object store. List and restore previews are read-only. Confirmed restore verifies the saved Git payload and hash before writing.

For an overwrite backup, restore also requires the current target bytes and Unix mode to still match the generated replacement. For a deletion backup, the target must still be absent. A newer edit or recreated path blocks restore instead of being clobbered. Windows preserves byte safety but does not apply physical Unix-mode checks.

`restore --list` classifies each run as `restorable-now`, `blocked-by-current-target`, or `corrupt-or-unavailable`. It cannot be combined with a backup id or `--yes`.

## Diagnostics

| Code | Meaning |
| --- | --- |
| `unmanaged-output-collision` | An unowned file occupied a required destination |
| `managed-output-edited` | Lock-owned output no longer matched its previous hash |
| `managed-output-missing` | Lock-owned output was absent and will be regenerated |

These cases are warnings when a reversible plan exists. A malformed lock is an error because safe ownership cannot be inferred.

## Provenance

Locks remain generated-output ownership authority. Snapshot manifests record backup id, target and source paths when known, action, reason, original/generated hashes and modes, tree path, and owning Git commit. Snapshots are recovery aids, not [canonical source](../../glossary.md#canonical-source), and stay separate from delete-safe cache output.

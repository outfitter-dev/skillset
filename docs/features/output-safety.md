# Output Safety

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `output-safety` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `output-safety`

Skillset treats generated target files as reproducible renderings while still protecting hand-authored files that happen to live near those renderings. Output safety is the build-time ownership layer that decides which files are managed, which files are unmanaged neighbors, and when a reversible backup is required before writing.

## Source Shape

There is no author-facing source key for output safety. Ownership is derived from generated `skillset.lock` files and the files the current build would render.

Managed files are files recorded by a current or previous Skillset lock. Workspace-managed project files such as generated `AGENTS.md` and provider-source project files are recorded in the root `skillset.lock`. Plugin and standalone skill roots record ownership in their nearby generated `skillset.lock` files. Entity-local `CHANGELOG.md` files are also managed projections when release history renders them beside source entities.

Unmanaged files are files under or beside generated output roots that no Skillset lock currently owns. `skillset diff`, `skillset check --only outputs`, and stale-file cleanup ignore unmanaged neighbors so a repo can keep hand-authored files near generated output without Skillset claiming or deleting them.

## Target Support

| Case | Behavior | Status |
| --- | --- | --- |
| Unmanaged neighbor inside an output root | Ignored by diff/output checks/stale cleanup | `implemented` |
| Unmanaged file at a path Skillset must emit | Back up, warn, then overwrite during a confirmed build | `implemented` |
| Managed generated file edited after the previous lock | Back up before replacing or deleting it | `implemented` |
| Missing managed file | Warn that it will be regenerated | `implemented` |
| Corrupt Skillset lock | Fail before build/output checks/diff can make ownership decisions | `implemented` |
| Restore backup by ref | Preview by default, write only with `--yes` | `implemented` |

## Build Behavior

`skillset build` is still plan-first at the CLI layer: without `--yes`, it previews generated changes and writes nothing. During a confirmed write, Skillset prepares safety backups before replacing a conflicting path or deleting a managed target-side edit.

Backups live under the gitignored recovery snapshot root:

```text
.skillset/snapshots/<backup-id>/manifest.json
.skillset/snapshots/<backup-id>/git/
```

Backup manifests use schema version 2 and store backed-up bytes in a per-run bare Git object store. The manifest records the backup id, target path, Git tree path, action, reason, original hash, generated hash when applicable, source path when known, and the Git commit that owns the snapshot. Build diagnostics include the backup id and manifest path, and `build --yes` prints a short backup summary when a backup was created.

`compile.build: updated` writes missing or changed generated files and removes stale managed files while leaving unchanged managed files and unmanaged neighbors alone. `compile.build: all` rewrites the selected generated files and removes stale managed files; it does not delete whole output roots or claim unmanaged neighbors.

`--isolated` applies the same ownership and backup rules inside the logical `.skillset/cache/latest/` mirror, backed by the repo's XDG cache bucket, so a mirror build can be inspected without touching live target roots.

Generated changelogs are the currently implemented managed-output case where "just rebuild it" can discard useful author intent. When `skillset diff`, `skillset change status`, or `skillset check --ci` reports drift for a managed `CHANGELOG.md`, treat the edit as a source-side correction request: use `skillset change reason <@ref>` for pending wording before release, `skillset change amend <@ref>` for applied history wording after release, or `skillset release amend <@ref>` for release-event metadata. `skillset check --ci --fix` may still mechanically restore the projection from source, but the diagnostics should make the source-side recovery path visible first.

The broader recovery model is [Source Suggestions](source-suggestions.md). The implemented local reconciliation workflow uses lock ownership to explain the source path behind a generated edit, preview clean source-side patches, and refuse unsafe reverse patches. Automated CI writeback remains future work; output safety stays conservative and never silently accepts generated edits as source truth.

## Restore

Use `restore` with a backup id from the warning or manifest path:

```bash
skillset restore <backup-id> --root .
skillset restore <backup-id> --root . --yes
```

The first command previews the restore. The second writes the backed-up bytes back to the original target paths.

Restore reads each backup payload from the manifest's Git commit and validates that it still matches the manifest hash. For overwrite backups, it also verifies that the current target still matches the generated replacement hash before restoring. If the target changed again after the backup, restore refuses so it does not clobber a newer edit. For delete backups, restore refuses if the target path already exists.

## Validation

Output safety diagnostics use warning severity for reversible backup cases:

| Code | Meaning |
| --- | --- |
| `unmanaged-output-collision` | Skillset needed to write a path that existed but was not lock-owned. |
| `managed-output-edited` | A lock-owned output differed from the previous output hash before Skillset replaced or deleted it. |
| `managed-output-missing` | A lock-owned output was missing and will be regenerated. |

Malformed generated locks fail loudly because Skillset cannot safely distinguish managed files from unmanaged files without trustworthy lock provenance.

## Provenance

Lock files remain the source of generated-output ownership. Backup manifests and their per-run Git object stores are recovery aids, not source truth, and live under `.skillset/snapshots/` so they stay separate from delete-safe cache output.

Generated skill frontmatter stays lightweight. Output ownership, hashes, target-side edit evidence, stale managed paths, and backup information belong in locks, diagnostics, and backup manifests rather than in generated target files.

## Evidence

Fixtures cover Git-backed unmanaged collision backups, target-side edit backups, backup restore previews and writes, unmanaged neighbors inside output roots, stale managed output checks, generated changelog recovery hints, disabled generated roots with legacy Skillset locks, and isolated mirror backup behavior.

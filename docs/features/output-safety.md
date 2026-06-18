# Output Safety

Feature id: `output-safety`

Skillset treats generated target files as reproducible renderings while still protecting hand-authored files that happen to live near those renderings. Output safety is the build-time ownership layer that decides which files are managed, which files are unmanaged neighbors, and when a reversible backup is required before writing.

## Source Shape

There is no author-facing source key for output safety. Ownership is derived from generated `.skillset.lock` files and the files the current build would render.

Managed files are files recorded by a current or previous Skillset lock. Workspace-managed project files such as generated `AGENTS.md` and provider-source project files are recorded in the root `.skillset.lock`. Plugin and standalone skill roots record ownership in their nearby generated `.skillset.lock` files.

Unmanaged files are files under or beside generated output roots that no Skillset lock currently owns. `skillset diff`, `skillset check`, and stale-file cleanup ignore unmanaged neighbors so a repo can keep hand-authored files near generated output without Skillset claiming or deleting them.

## Target Support

| Case | Behavior | Status |
| --- | --- | --- |
| Unmanaged neighbor inside an output root | Ignored by diff/check/stale cleanup | `implemented` |
| Unmanaged file at a path Skillset must emit | Back up, warn, then overwrite during a confirmed build | `implemented` |
| Managed generated file edited after the previous lock | Back up before replacing or deleting it | `implemented` |
| Missing managed file | Warn that it will be regenerated | `implemented` |
| Corrupt Skillset lock | Fail before build/check/diff can make ownership decisions | `implemented` |
| Restore backup by ref | Preview by default, write only with `--yes` | `implemented` |

## Build Behavior

`skillset build` is still plan-first at the CLI layer: without `--yes`, it previews generated changes and writes nothing. During a confirmed write, Skillset prepares safety backups before replacing a conflicting path or deleting a managed target-side edit.

Backups live under the gitignored build root:

```text
.skillset/build/backups/<backup-id>/manifest.json
.skillset/build/backups/<backup-id>/files/<target-path>.bak.<backup-id>
```

The manifest records the backup id, target path, backup path, action, reason, original hash, generated hash when applicable, and source path when known. Build diagnostics include the backup id and manifest path, and `build --yes` prints a short backup summary when a backup was created.

`compile.build: updated` writes missing or changed generated files and removes stale managed files while leaving unchanged managed files and unmanaged neighbors alone. `compile.build: all` rewrites the selected generated files and removes stale managed files; it does not delete whole output roots or claim unmanaged neighbors.

`--isolated` applies the same ownership and backup rules inside `.skillset/build/out/`, so a mirror build can be inspected without touching live target roots.

## Restore

Use `restore` with a backup id from the warning or manifest path:

```bash
skillset restore <backup-id> --root .
skillset restore <backup-id> --root . --yes
```

The first command previews the restore. The second writes the backed-up bytes back to the original target paths.

Restore validates that each backup file still matches the manifest hash. For overwrite backups, it also verifies that the current target still matches the generated replacement hash before restoring. If the target changed again after the backup, restore refuses so it does not clobber a newer edit. For delete backups, restore refuses if the target path already exists.

## Validation

Output safety diagnostics use warning severity for reversible backup cases:

| Code | Meaning |
| --- | --- |
| `unmanaged-output-collision` | Skillset needed to write a path that existed but was not lock-owned. |
| `managed-output-edited` | A lock-owned output differed from the previous output hash before Skillset replaced or deleted it. |
| `managed-output-missing` | A lock-owned output was missing and will be regenerated. |

Malformed generated locks fail loudly because Skillset cannot safely distinguish managed files from unmanaged files without trustworthy lock provenance.

## Provenance

Lock files remain the source of generated-output ownership. Backup manifests are recovery aids, not source truth, and live under `.skillset/build/` so they can be pruned like other local build artifacts.

Generated skill frontmatter stays lightweight. Output ownership, hashes, target-side edit evidence, stale managed paths, and backup information belong in locks, diagnostics, and backup manifests rather than in generated target files.

## Evidence

Fixtures cover unmanaged collision backups, target-side edit backups, backup restore previews and writes, unmanaged neighbors inside output roots, stale managed output checks, disabled generated roots with legacy Skillset locks, and isolated mirror backup behavior.

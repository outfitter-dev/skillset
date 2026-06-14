# Releases And Changelogs

Feature id: `releases`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Releases turn accepted source changes into stable artifact versions, generated changelog projections, append-only release records, lock updates, and target output updates. Release state is optional and source-controlled; it is separate from source content and ordinary generated metadata.

## Authoring

Release state lives with change state under `.skillset/changes/state.json`. Applied change history appends to `.skillset/changes/history.jsonl`, and release records append to `.skillset/changes/releases.jsonl`. Entity-local `CHANGELOG.md` files are generated tracked projections placed beside source entities like plugins and skills. Pending changes are preview/status data, not committed pending sections in tracked changelogs.

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Release state | plugin `version`, skill `metadata.version` | plugin `version`, skill `metadata.version` | `implemented` | Release state wins over inline source versions; inline versions remain the import/read fallback. |
| Entity `CHANGELOG.md` projection | generated Markdown | generated Markdown | `implemented` | Generated frontmatter marks Skillset ownership. Ignored history entries are excluded from changelog projections. |
| Pending entries | n/a | n/a | `implemented` | `release plan` previews entries without writing; `release apply --yes` consumes them into append-only history. |

## Diagnostics

`skillset release plan` previews pending entries, ignored audit entries, derived release scopes, version changes, and source hashes without writing. `skillset release apply --yes` writes release state, consumes pending entries into append-only history, appends release records for non-ignored release scopes, refreshes generated changelogs, updates locks, and refreshes target outputs. Running `release apply` without `--yes` prints the plan and writes nothing; `--dry-run` is also write-free. Release commands reject build `--scope` until scoped release selection exists, because v1 apply consumes all pending entries and refreshes all generated outputs. Build metadata is not used as a public update strategy in v1 because target update behavior for build-metadata-only versions is unproven.

## Provenance

Release records capture selected change ids, source hashes, resolved versions, and source-hash baseline metadata. `skillset change status` uses release-state source hashes as the durable baseline rather than a symbolic git ref, so applying a release before committing still records the released source identity. Deleted source units are written as release-state tombstones, which removes them from the baseline inventory after the deletion is released. Plugin aggregate release scopes are derived from child plugin skill, feature, companion, and target-native island entries by default; plugin config changes still need their own plugin-level release story. External package release tools such as Changesets and release-please remain external authorities unless a future explicit bridge is configured.

Package releases for the public `skillset` npm package are documented separately in [Package Releases](../package-releases.md). Changesets owns npm package versions and package changelog calculation, while Skillset source-unit releases own `.skillset/changes` provenance and generated entity changelogs.

## Tests and Fixtures

Fixtures cover first release state creation, read-only plan and dry-run behavior, pending entry consumption, append-only history and release records, generated changelog refresh, generated target version updates, release-state baseline behavior before and after commits, scoped release rejection, plugin aggregate bumps from child skill entries, plugin feature changelog projection, malformed release-state validation, released deletion tombstones, `bump: none`, and `ignored: true` audit entries.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md), [Changelog and Version Bump Workflow](../adrs/drafts/20260604-changelog-and-versioning.md), and [Change and Release Edge Decisions](../adrs/drafts/20260609-change-release-edge-decisions.md).

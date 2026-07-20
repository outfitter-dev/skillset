# Releases And Changelogs

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `releases` | `implemented` | `metadata_only` | `metadata_only` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `releases`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Releases turn accepted source changes into stable artifact versions, generated changelog renderings, append-only release records, lock updates, and target output updates. Release state is optional and source-controlled; it is separate from source content and ordinary generated metadata.

## Authoring

Release state lives with change state under the workspace change directory. New release-state authority comes from `ledger.jsonl` `release.applied` events, while `.skillset/changes/state.json` remains a compatibility/cache projection. Applied change history appends to `history.jsonl`, and release records append to `releases.jsonl`. Entity-local `CHANGELOG.md` files are generated tracked renderings placed beside source entities like plugins and skills. Pending changes are preview/status data, not committed pending sections in tracked changelogs.

The reason-only ledger cutover keeps generated changelogs as tracked projections but treats release/status state as rebuildable from an append-only event ledger instead of as an authoring surface. New pending reasons write schema-versioned `.skillset/changes/ledger.jsonl` records for reason lifecycle and source coverage, and release apply appends `release.applied` records for selected change ids, resolved versions, tombstones, and source hashes. Compatibility `history.jsonl`, `releases.jsonl`, amendments, and `state.json` surfaces stay readable during the cutover. See [Reason-Only Change Ledger and Derived State](../adrs/drafts/20260630-reason-only-change-ledger-derived-state.md) for the design.

Generated changelogs are reviewable projections, not editing surfaces. Before release, wording changes should update the pending entry with `skillset change reason <@ref>` and then rebuild. After release, source-change reason corrections use `skillset change amend <ref>`, and release-event metadata or release-note corrections use `skillset release amend <ref>`. Both commands append correction records under the workspace change directory, leaving original history auditable while generated changelog projections can be rebuilt from source-side state.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Release state | plugin `version`, skill `metadata.version` | plugin `version`, skill `metadata.version` | `implemented` | Release state wins over inline source versions; inline versions remain the import/read fallback. |
| Entity `CHANGELOG.md` rendering | generated Markdown | generated Markdown | `implemented` | Generated frontmatter marks Skillset ownership. Ignored history entries are excluded from changelog renderings. |
| Pending entries | n/a | n/a | `implemented` | `release plan` previews reason-only and compatibility frontmatter entries without writing; `release apply --yes` consumes them into append-only history. |
| Change ledger events | n/a | n/a | `implemented` | `ledger.jsonl` records reason lifecycle, pending source coverage, and release-state projection. |

## Diagnostics

`skillset release plan` previews pending entries, ignored audit entries, derived release scopes, version changes, and source hashes without writing. `skillset release apply --yes` writes release-state compatibility output, appends `release.applied` ledger evidence, consumes pending entries into append-only history, appends release records for non-ignored release scopes, refreshes generated changelogs, updates locks, and refreshes target outputs. Running `release apply` without `--yes` prints the plan and writes nothing; `skillset release amend <@ref> --reason ...` appends release-event notes to `changes/release-amendments.jsonl` without rewriting the original release record. Release commands reject build `--scope` until scoped release selection exists, because v1 apply consumes all pending entries and refreshes all generated outputs. Build metadata is not used as a public update strategy in v1 because target update behavior for build-metadata-only versions is unproven.

## Provenance

Release records capture selected change ids, source hashes, resolved versions, and source-hash baseline metadata. `skillset change status` uses ledger-derived release-state source hashes as the durable baseline rather than a symbolic git ref, so applying a release before committing still records the released source identity. Deleted source units are written as release-state tombstones in the ledger and compatibility state, which removes them from the baseline inventory after the deletion is released. Plugin aggregate release scopes are derived from child plugin skill, feature, companion, and provider-source entries by default; plugin config changes still need their own plugin-level release story. External package release tools such as Changesets and release-please remain external authorities unless a future explicit bridge is configured.

Package releases for the public `skillset` npm package are documented separately in [Package Releases](../package-releases.md). Changesets owns npm package versions and package changelog calculation, while Skillset source-unit releases own workspace `changes` provenance and generated entity changelogs.

## Tests and Fixtures

Fixtures cover first release state creation, read-only plan and dry-run behavior, pending entry consumption, append-only history and release records, release amendments, generated changelog refresh, generated changelog drift guidance, generated target version updates, release-state baseline behavior before and after commits, scoped release rejection, plugin aggregate bumps from child skill entries, plugin feature changelog rendering, malformed release-state validation, released deletion tombstones, `bump: none`, and `ignored: true` audit entries.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md), [Changelog and Version Bump Workflow](../adrs/drafts/20260604-changelog-and-versioning.md), [Change and Release Edge Decisions](../adrs/drafts/20260609-change-release-edge-decisions.md), and [Reason-Only Change Ledger and Derived State](../adrs/drafts/20260630-reason-only-change-ledger-derived-state.md).

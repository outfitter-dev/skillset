# Releases And Changelogs

Feature id: `releases`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Releases turn accepted source changes into stable artifact versions, generated changelog projections, append-only release records, lock updates, and target output updates. Release state is optional and source-controlled; it is separate from source content and ordinary generated metadata.

## Authoring

Release records live with change state under `.skillset/changes/`, such as `releases.jsonl`. Entity-local `CHANGELOG.md` files are generated tracked projections placed beside source entities like plugins and skills. Pending changes are preview/status data, not committed pending sections in tracked changelogs.

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Release state | plugin `version`, skill `metadata.version` | plugin `version`, skill `metadata.version` | `planned` | Resolves generated artifact versions without inline source-version churn. |
| Entity `CHANGELOG.md` projection | generated Markdown | generated Markdown | `planned` | Generated frontmatter marks Skillset ownership. |
| Pending entries | n/a | n/a | `planned` | Preview/status only until applied. |

## Diagnostics

`skillset release plan` previews selected entries, version changes, generated changelog sections, and target impacts without writing. `skillset release apply` writes release state, generated changelogs, append-only history/release records, locks, and target outputs. Build metadata is not used as a public update strategy in v1 because target update behavior for build-metadata-only versions is unproven.

## Provenance

Release records capture selected change ids, source hashes, aggregate hashes, resolved versions, target state, and generated output hashes. External package release tools such as Changesets and release-please remain external authorities unless a future explicit bridge is configured.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md), [Changelog and Version Bump Workflow](../adrs/drafts/20260604-changelog-and-versioning.md), and [Change and Release Edge Decisions](../adrs/drafts/20260609-change-release-edge-decisions.md).

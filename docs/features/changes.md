# Changes

Feature id: `changes`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Changes record why source units changed. They are source-side evidence for status, history, changelog projection, and release planning. They are not generated target output and they are not package release state.

## Authoring

Pending entries live under `.skillset/changes/pending/` as Markdown files with YAML frontmatter and a required prose body. The body is the authored reason and eventual changelog source. Frontmatter carries `id`, `scope`, `bump`, optional `group`, hash evidence, suggested bump, and overrides.

Compact ids are generated once at scaffold time as 12 lower-case hex characters. CLI refs use `@<prefix>` with shortest-unambiguous resolution and a minimum 6-character prefix. Group ids are filtering and reporting aids; they do not imply release grouping.

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `.skillset/changes/pending/*.md` | n/a | n/a | `planned` | Parsed by change commands; not target output. |
| `.skillset/changes/history.jsonl` | n/a | n/a | `planned` | Append-only applied history. |
| `.skillset/changes/baseline` records | n/a | n/a | `planned` | Explicit hash-schema baseline records, not changelog entries. |

## Diagnostics

`skillset change status` compares current source units with the active baseline and reports changed units with or without covering entries. `skillset change check` validates entry ids, scopes, bumps, reason bodies, hash freshness, duplicate ids, group shape, and bump overrides. Source coverage diagnostics stay separate from generated-output drift.

## Provenance

Change entries participate in source provenance because they explain current source changes, but they do not become target artifacts. Applied entries move into append-only history and feed generated changelog projections and release records.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md) and [Change and Release Edge Decisions](../adrs/drafts/20260609-change-release-edge-decisions.md).

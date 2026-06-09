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
| Source-unit inventory | n/a | n/a | `implemented` | `skillset change status` hashes supported source units with schema `skillset-source-unit-v1`. |
| `skillset change status --since <ref>` | n/a | n/a | `implemented` | Read-only comparison against a git ref; generated-output drift is reported separately. |
| `.skillset/changes/pending/*.md` | n/a | n/a | `planned` | Parsed by change commands; not target output. |
| `.skillset/changes/history.jsonl` | n/a | n/a | `planned` | Append-only applied history. |
| `.skillset/changes/baseline` records | n/a | n/a | `planned` | Explicit hash-schema baseline records, not changelog entries. |

## Diagnostics

`skillset change status --since <ref>` compares current source units with the selected git ref without writing generated output. It reports source changes needing entries and then reports generated-output drift as a separate section. The default baseline tries future release records first, then source-inventory locks when present, then git merge-base.

`skillset change check` remains planned. It will validate entry ids, scopes, bumps, reason bodies, hash freshness, duplicate ids, group shape, and bump overrides. Source coverage diagnostics stay separate from generated-output drift.

## Provenance

Source-unit hashes cover root config, standalone skills, plugin configs, plugin skills, plugin features such as MCP/bin pointers, plugin target-native companion paths such as hooks and apps, project instructions, project agents, and target-native islands. Plugin aggregate hashes consume child content hashes before declared versions, so a child content edit with an unchanged version still changes the plugin aggregate identity.

Change entries participate in source provenance because they explain current source changes, but they do not become target artifacts. Applied entries move into append-only history and feed generated changelog projections and release records.

## Tests and Fixtures

Fixtures cover unchanged deterministic status, body edits, source-only support/dependency metadata edits, plugin child edits that affect aggregate plugin identity without a version bump, read-only CLI behavior, and generated-output drift separation.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md) and [Change and Release Edge Decisions](../adrs/drafts/20260609-change-release-edge-decisions.md).

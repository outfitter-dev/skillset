# Changes

Feature id: `changes`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Changes record why source units changed. They are source-side evidence for status, history, changelog rendering, and release planning. They are not generated target output and they are not package release state.

## Authoring

Pending entries live under `.skillset/changes/pending/` as Markdown files with YAML frontmatter and a required prose body. The body is the authored reason and eventual changelog source. Frontmatter carries `id`, `scope`, `bump`, optional `group`, hash evidence, suggested bump, and overrides.

Compact ids are generated once at scaffold time as 12 lower-case hex characters. CLI refs use `@<prefix>` with shortest-unambiguous resolution and a minimum 6-character prefix. Group ids are filtering and reporting aids; they do not imply release grouping.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Source-unit inventory | n/a | n/a | `implemented` | `skillset change status` hashes supported source units with schema `skillset-source-unit-v2`. |
| `skillset change status --since <ref>` | n/a | n/a | `implemented` | Read-only comparison against a git ref; generated-output drift is reported separately. |
| `.skillset/changes/pending/*.md` | n/a | n/a | `implemented` | Created, listed, shown, edited, validated by `skillset change`, and consumed by `skillset release apply --yes`; not target output. |
| `.skillset/changes/history.jsonl` | n/a | n/a | `implemented` | Append-only applied history is read by `skillset change history`, written by release apply, and used by changelog renderings. |
| `.skillset/changes/baseline` records | n/a | n/a | `planned` | Explicit hash-schema baseline records, not changelog entries. |

## Diagnostics

`skillset change status --since <ref>` compares current source units with the selected git ref without writing generated output. It reports source changes needing entries and then reports generated-output drift as a separate section. The command is whole-source in v1; build `--scope` filters are rejected for `change status` and `change check` because they would only scope generated destinations, not source coverage. The default baseline overlays release-state source hashes onto the normal fallback inventory, then falls back to source-inventory locks when present, then git merge-base.

`skillset change check` validates pending entry ids, duplicate ids, scopes, bumps, required reason bodies, source hash evidence, group shape, and coverage for current source changes. Entries can cover multiple scopes, carry `ignored: true`, and use `group` for external issue or change grouping metadata. Child plugin entries cover the derived plugin aggregate for coverage and release planning, but plugin config changes still require their own plugin-level story. `external.*` is rejected in v1 so issue ids do not get duplicated outside `group`. Refs resolve as `@<hex-prefix>` with at least 6 hex characters, and ambiguous prefixes fail with candidate refs.

Stacked branches may produce multiple pending entries for the same source unit. `change check` intentionally stays strict: each entry must carry evidence for the current source hash at the stack tip. If two valid entries point at the same scope and hash, the check prints a `stacked evidence` note so release/history attribution is explicit. If one entry still points at an older hash, it remains a `change-evidence-stale` error even when another entry covers the same scope, because silently borrowing another reason would hide lower-branch work.

`change check` also warns when an entry declares `bump: none` for an added, removed, or severity-bearing source unit. `supports` edits remain source-significant but are not inherently severity-bearing. Source coverage diagnostics stay separate from generated-output drift.

`skillset change add` writes pending entries non-interactively from `--reason`, `--reason-file`, `--reason -`, or piped stdin. `skillset change reason` updates or appends to a pending reason without changing the generated id. `skillset change list` prints copyable refs and supports `--group` filtering. `skillset change show` resolves pending entries before applied history. `skillset change history` reads applied history records and stays distinct from status.

## Provenance

Source-unit hashes cover root config, standalone skills, plugin configs, plugin skills, plugin features such as MCP/bin pointers, plugin target-native companion paths such as hooks and apps, project instructions, project agents, and provider source. Plugin aggregate hashes consume child content hashes before declared versions, so a child content edit with an unchanged version still changes the plugin aggregate identity.

Change entries participate in source provenance because they explain current source changes, but they do not become target artifacts. Applied entries move into append-only history and feed generated changelog renderings and release records. Entries marked `ignored: true` are preserved in history but excluded from release scopes and generated changelog renderings; release apply still records their source hash in release state so default status does not keep reporting the ignored source edit.

## Tests and Fixtures

Fixtures cover unchanged deterministic status, body edits, source-only support/dependency metadata edits, plugin child edits that affect aggregate plugin identity without a version bump, child plugin coverage of aggregate plugin changes, partial dependency hashing, read-only CLI behavior, generated-output drift separation, pending-entry coverage failures, multi-scope pending entries, repeated stacked entries for one current source hash, invalid pending entry diagnostics, ambiguous ref resolution, reason file/stdin input, append behavior, group filters, show output, and history lookup.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md) and [Change and Release Edge Decisions](../adrs/drafts/20260609-change-release-edge-decisions.md).

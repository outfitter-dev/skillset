# Changes

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `changes` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `changes`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Changes record why source units changed. They are source-side evidence for status, history, changelog rendering, and release planning. They are not generated target output and they are not package release state.

## Authoring

Pending entries live under the workspace change directory as Markdown files: `.skillset/changes/`. New `skillset change add` writes reason-only Markdown. The body is the authored reason and eventual changelog source, with lightweight readable directives such as `Bump:`, `Group:`, and `Scope:`. Skillset owns generated ids, source hashes, and evidence in `ledger.jsonl` instead of asking authors to maintain that metadata by hand.

Existing YAML-frontmatter pending entries remain a compatibility input during the cutover. Compatibility validation still uses the generated `@skillset/schema` change-entry contract before applying semantic checks such as duplicate ids, known scopes, evidence freshness, and source coverage. `skillset change migrate` previews those old entries, and `skillset change migrate --yes` rewrites them to reason-only Markdown plus equivalent `ledger.jsonl` events. The compatibility schema stays available as a recovery aid, but new docs and command output should treat it as legacy cleanup surface rather than normal hand-authored source.

Compact ids are generated once at scaffold time as 12 lower-case hex characters. CLI refs use `@<prefix>` with shortest-unambiguous resolution and a minimum 6-character prefix. Group ids are filtering and reporting aids; they do not imply release grouping.

The workspace change directory is a committed ledger, not a generated-output lock. Pending entries are the `*.md` files in that directory. Applied history stays in `history.jsonl`, release records stay in `releases.jsonl`, release events and source-unit coverage stay in `ledger.jsonl`, and `state.json` remains compatibility/cache output. Generated-output ownership, hashes, render results, and current drift evidence stay in nearby `skillset.lock` files instead of being folded into human-authored change reasons.

The active cutover is a reason-only authoring model where humans write change reasons and Skillset derives ids, source hashes, coverage, and rebuildable state into a machine event ledger. See [Reason-Only Change Ledger and Derived State](../adrs/0015-reason-only-change-ledger-derived-state.md) for the design.

### Ledger Events

Skillset uses `.skillset/changes/ledger.jsonl` as the machine event stream for new pending-entry authoring. The reader accepts schema-versioned JSONL records with this envelope:

```json
{
  "schemaVersion": 1,
  "id": "evt-001",
  "type": "change.covered",
  "createdAt": "2026-06-30T00:00:00.000Z",
  "payload": {
    "reasonId": "change-1",
    "evidence": [
      {
        "selector": "skill:demo",
        "sourceHash": "sha256:...",
        "hashSchema": "skillset-source-unit-v2"
      }
    ]
  }
}
```

The initial event vocabulary is `reason.created`, `reason.updated`, `change.covered`, `change.ignored`, `release.applied`, `change.amended`, `release.amended`, and `baseline.recorded`. Ledger records preserve append order and carry file/line diagnostics when malformed JSONL, unsupported event types, duplicate event ids, or invalid payloads are encountered.

`skillset change add` writes `reason.created` and `change.covered` events alongside the reason-only Markdown file. `skillset change reason` appends `reason.updated` events while preserving the pending id. `skillset release apply --yes` appends `release.applied` events with selected change ids, resolved versions, tombstones, and source-unit hashes. Existing `history.jsonl`, `releases.jsonl`, `amendments.jsonl`, and `state.json` remain compatibility inputs while ledger projection becomes the release-state authority for scopes it can rebuild.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Source-unit inventory | n/a | n/a | `implemented` | `skillset change status` hashes supported source units with schema `skillset-source-unit-v2`. |
| `skillset change status --since <ref>` | n/a | n/a | `implemented` | Read-only comparison against a git ref; generated-output drift is reported separately. |
| `changes/*.md` | n/a | n/a | `implemented` | New command-created entries are reason-only Markdown; legacy frontmatter entries remain compatibility-readable and migratable with `skillset change migrate --yes`. Created, listed, shown, edited, validated by `skillset change`, and consumed by `skillset release apply --yes`; stored under `.skillset/changes`. |
| `changes/history.jsonl` | n/a | n/a | `implemented` | Append-only applied history is read by `skillset change history`, written by release apply, and used by changelog renderings. |
| `changes/amendments.jsonl` | n/a | n/a | `implemented` | Append-only corrections written by `skillset change amend <@ref>`; changelog renderings use the latest correction while original history remains auditable. |
| `changes/ledger.jsonl` | n/a | n/a | `implemented` | Schema-versioned event stream for reason lifecycle, source-unit coverage, and release-state projection. |
| `changes/baseline` records | n/a | n/a | `planned` | Explicit hash-schema baseline records, not changelog entries. |

## Diagnostics

`skillset change status --since <ref>` compares current source units with the selected git ref without writing generated output. It reports source changes needing entries and then reports generated-output drift as a separate section. The command is whole-source in v1; build `--scope` filters are rejected for `change status` and `change check` because they would only scope generated destinations, not source coverage. The default baseline overlays ledger-derived release-state source hashes onto the normal fallback inventory, then falls back to compatibility `state.json`, source-inventory locks when present, then git merge-base.

`skillset change check` reads reason-only entries with ledger-owned evidence, keeps compatibility validation for old frontmatter entries, then checks duplicate ids, known scopes, required reason bodies, source hash evidence, and coverage for current source changes. When an old frontmatter entry is still valid, `change check` emits a compatibility warning with the cleanup command instead of treating the old shape as current authoring guidance. Entries can cover multiple scopes, carry `ignored: true`, and use `group` for external issue or change grouping metadata. Child plugin entries cover the derived plugin aggregate for coverage and release planning, but plugin config changes still require their own plugin-level story. `external.*` is rejected in v1 so issue ids do not get duplicated outside `group`. Refs resolve as `@<hex-prefix>` with at least 6 hex characters, and ambiguous prefixes fail with candidate refs.

`skillset change refresh [@ref]` previews stale or missing evidence and appends the planned `change.covered` events only with `--yes`. When repairing a failure from `change check --since <ref>`, pass that exact baseline again as `change refresh --since <ref>`; removed scopes and the removed half of renames use the selected baseline hash, which may differ from the default release-state, lock, or trunk merge-base inventory. Refresh deliberately does not accept `--staged`, `--all`, or `--updated`.

`skillset change ignore <@ref>` is the intentional audit disposition for a valid reason-only pending entry. It previews by default and appends the existing `change.ignored` evidence only with `--yes`; the pending reason file and its current coverage evidence remain visible to `change list`, `change check`, and release planning, but release planning excludes its bump and changelog entry. Existing frontmatter compatibility entries must first use `skillset change migrate --yes`. This source-ledger decision is separate from target-side generated edits: use `skillset reconcile <path> --use output` to bring an edit into source, or `skillset reconcile <path> --use source` to intentionally discard it and restore the source projection.

Stacked branches may produce multiple pending entries for the same source unit. `change check` intentionally stays strict: each entry must carry evidence for the current source hash at the stack tip. If two valid entries point at the same scope and hash, the check prints a `stacked evidence` note so release/history attribution is explicit. If one entry still points at an older hash, it remains a `change-evidence-stale` error even when another entry covers the same scope, because silently borrowing another reason would hide lower-branch work.

`change check` also warns when an entry declares `bump: none` for an added, removed, or severity-bearing source unit. `supports` edits remain source-significant but are not inherently severity-bearing. Source coverage diagnostics stay separate from generated-output drift.

Schema and provider-format work can need both ledgers. A Skillset pending change entry records the source-unit reason when a contract, provider support row, migration, or generated-output promise changes inside the workspace. A package Changeset records the npm-facing CLI/runtime change when the branch touches `packages/schema/src/**`, `packages/registry/src/**`, or package metadata. Generated schema artifacts under `docs/reference/schemas/**` and `docs/reference/examples/**` stay with the schema source change, but they are derived evidence rather than a substitute for the source package Changeset.

Use pending-entry language that names the visible drift class:

| Change class | Pending-entry wording shape |
| --- | --- |
| Compatible provider refresh | `Refresh provider schema snapshot evidence for <surface>; generated output remains byte-compatible.` |
| Safe destination-format migration | `Add a safe <provider> <destination> destination-format update so check --fix/update --yes can rewrite generated outputs without changing Skillset source.` |
| Manual-review provider drift | `Record <provider> <destination> destination-format drift as manual review so affected outputs are reported without automatic writes.` |
| Schema contract update | `Update the <field/surface> source contract and regenerate schema/example artifacts so CLI, Workbench, and docs validate the same shape.` |

`skillset change add` writes reason-only pending entries non-interactively from `--reason`, `--reason-file`, `--reason -`, or piped stdin, then appends ledger events for the stable id and current source-unit evidence. `skillset change migrate` is the explicit cutover command for existing frontmatter entries: dry-run by default, and write-gated behind `--yes`. `skillset change reason` updates or appends to a pending reason without changing the generated id. That command is the pre-release correction path for generated changelog wording: edit the pending reason, rebuild, and let Skillset refresh entity-local `CHANGELOG.md` projections. `skillset change list` prints copyable refs and supports `--group` filtering. `skillset change show` resolves pending entries before applied history. `skillset change history` reads applied history records and stays distinct from status.

After release, applied change history is append-only. Post-release wording corrections use `skillset change amend <ref> --reason ...`, so the original applied entry remains auditable in `history.jsonl` and generated changelog projections are regenerated from the latest correction in `amendments.jsonl`. If the ref still points at a pending entry, use `skillset change reason <ref>` before release instead. Release-event metadata or release-note corrections belong to `skillset release amend <ref>` rather than to `change reason`.

## Provenance

Source-unit hashes cover root config, standalone skills, plugin configs, plugin skills, plugin features such as MCP/bin pointers, plugin target-native companion paths such as hooks and apps, project instructions, project agents, and provider source. Plugin aggregate hashes consume child content hashes before declared versions, so a child content edit with an unchanged version still changes the plugin aggregate identity.

Change entries participate in source provenance because they explain current source changes, but they do not become target artifacts. Applied entries move into append-only history and feed generated changelog renderings and release records. Entries marked `ignored: true` are preserved in history but excluded from release scopes and generated changelog renderings; release apply still records their source hash in release state so default status does not keep reporting the ignored source edit.

## Tests and Fixtures

Fixtures cover unchanged deterministic status, body edits, source-only support/dependency metadata edits, plugin child edits that affect aggregate plugin identity without a version bump, child plugin coverage of aggregate plugin changes, partial dependency hashing, read-only CLI behavior, generated-output drift separation, generated changelog drift guidance, pending-entry coverage failures, multi-scope pending entries, repeated stacked entries for one current source hash, invalid pending entry diagnostics, frontmatter compatibility migration, ambiguous ref resolution, reason file/stdin input, append behavior, group filters, show output, history lookup, and applied-history amendment projection.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/0014-source-change-release-provenance.md), [Change and Release Edge Decisions](../adrs/0016-change-release-edge-decisions.md), and [Reason-Only Change Ledger and Derived State](../adrs/0015-reason-only-change-ledger-derived-state.md).

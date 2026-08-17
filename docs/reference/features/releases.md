---
description: Skillset releases plan and apply workspace versions, changelogs, release evidence, and generated updates.
---

# Releases and Changelogs

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `releases` | `implemented` | `metadata_only` | `metadata_only` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

A [workspace](../../glossary.md#workspace) release turns accepted [source-change](changes.md) reasons into stable [source-unit](../../glossary.md#source-unit) versions, generated changelogs, append-only release evidence, updated locks, and refreshed provider output. It does not publish a package, sync a distribution, install output, or prove [activation](../../glossary.md#activation).

## Plan Before Applying

```bash
skillset release plan
skillset release apply
skillset release apply --yes
```

`plan` and an unconfirmed `apply` write nothing. The plan shows selected pending reasons, ignored audit entries, release scopes, version changes, and source hashes. Confirmed apply consumes all eligible pending reasons; release commands reject build `--scope` because scoped release selection does not exist.

The [publishing guide](../../guides/publishing.md) owns the end-to-end workflow. The generated [`release` reference](../cli/release.md) owns exact command syntax.

## What Apply Writes

A confirmed release:

- appends `release.applied` evidence to `.skillset/changes/ledger.jsonl`;
- moves applied reasons into append-only history and appends release records;
- advances source-unit version authority and records deletion tombstones;
- regenerates entity-local `CHANGELOG.md` [projections](../../glossary.md#projection);
- refreshes generated provider versions, output, and locks.

Release state wins over inline source versions when a release scope exists. Otherwise inline metadata remains the import/read fallback. Pending reasons never appear as a pending section in committed changelogs.

## Correct Wording Without Editing Generated Changelogs

| Timing | Intent | Command |
| --- | --- | --- |
| Before release | Change pending changelog wording | `skillset change reason <@ref> --reason "…"` |
| After release | Correct an applied source-change reason | `skillset change amend <@ref> --reason "…"` |
| After release | Correct release-event notes | `skillset release amend <@ref> --reason "…"` |

Amendments append evidence and leave original history auditable. Rebuild after the correction to refresh the generated changelog.

## Errors and Recovery

| Problem | Result | Recovery |
| --- | --- | --- |
| No pending eligible reasons | Plan reports no release | Add or correct change coverage |
| Stale source evidence | Apply refuses | Run `change check` and review `change refresh` |
| Invalid or corrupt release state | Validation fails before output writes | Repair source-side state from trusted ledger/history evidence |
| Generated changelog was edited | Output checks refuse to treat it as source | Use the correction table above |
| `--scope` is supplied | Command rejects it | Apply the complete release or defer it |
| Output collision or target-side edit | Build safety creates a backup or refuses | Follow [Output Safety](output-safety.md) |

An ignored change stays auditable but contributes no version bump or changelog entry. Its source hash is still recorded at apply so status does not repeatedly report the dispositioned edit.

## Separate Release Authorities

Skillset workspace releases own `.skillset/changes/`, source-unit versions, and entity changelogs. Changesets owns versions and changelogs for the public npm packages. Distribution plans and marketplace indexes are separate delivery evidence. Completing one lane does not authorize another; see [Package Releases](../../development/package-releases.md).

## Provenance

Release records include selected change ids, resolved versions, source hashes, and baseline metadata. Deleted scopes become tombstones. `skillset change status` uses ledger-derived release state as its durable baseline, even before the release commit exists.

Release records are append-only and derived release state resolves per scope in file order, so keep `.skillset/changes/*.jsonl` on the `merge=union` strategy described in [Merging Change Streams](changes.md#merging-change-streams).

See [Source Change, Release, and Dependency Provenance](../../adrs/0014-source-change-release-provenance.md), [Changelog and Version Bump Workflow](../../adrs/0013-changelog-and-versioning.md), and [Reason-Only Change Ledger and Derived State](../../adrs/0015-reason-only-change-ledger-derived-state.md).

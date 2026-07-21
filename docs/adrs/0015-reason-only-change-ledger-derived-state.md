---
id: 15
slug: reason-only-change-ledger-derived-state
title: Reason-Only Change Ledger and Derived State
status: accepted
created: 2026-06-30
updated: 2026-07-21
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 14]
amends: [14]
---

# ADR-0015: Reason-Only Change Ledger and Derived State

Status: accepted and implemented, with explicit legacy-frontmatter migration.

## Context

Before the cutover, the change and release implementation exposed too much
machine structure as the authoring surface. Pending changes were Markdown files
under `.skillset/changes/` with YAML frontmatter for `id`, `scope`, `bump`,
`group`, and source-hash evidence. Release apply consumed those files into
history and release projections, wrote mutable cache state, and refreshed
generated entity `CHANGELOG.md` projections.

That shape proved the source-change workflow, but it has three design problems:

- authors have to care about fields that should be derived from source status;
- generated ids, hashes, and release baselines can look like source truth;
- changelog wording, durable release events, and rebuildable status/cache state
  are mixed together in one mental model.

The accepted authoring flow is reason-first: an author explains why a
change exists, optionally choose a bump or group, and let Skillset normalize the
rest from current source inventory, release baselines, and command context.

## Decision

Use a reason-only authoring model backed by a normalized event ledger and
derived state cache.

### Source Truth

The committed authoring surface is a reason entry, not a hand-authored
frontmatter contract. A pending reason is Markdown prose with optional lightweight
directives that are natural for humans to read and merge:

```markdown
Updated marketplace rendering so repository-backed plugin references can be
checked and refreshed without copying plugin source into the marketplace repo.

Refs: SET-133
Bump: minor
Scope: plugin:skillset
```

The implemented syntax is Markdown prose plus readable `Refs:`, `Bump:`,
`Group:`, and `Scope:` directives. Humans author reason text and high-level
intent; Skillset owns generated ids, current source hashes, normalized
selectors, and release evidence.

### Normalized Ledger

`.skillset/changes/ledger.jsonl` becomes the durable append-only event stream.
Events are machine-written JSON records with stable schema versions. They record
what happened, not what the user must maintain by hand.

The event set covers:

- `reason.created` and `reason.updated` for pending reason lifecycle;
- `change.covered` for source-unit coverage derived from current inventory;
- `change.ignored` for audit entries that should baseline without changelog
  projection;
- `release.applied` for selected entries, resolved versions, source hashes, and
  release notes;
- `change.amended` and `release.amended` for post-release wording or metadata
  corrections;
- `baseline.recorded` for hash-schema or adoption baselines that are not
  changelog entries.

Events carry `id`, `createdAt`, `schemaVersion`, and a deterministic payload
shape. Where a record refers to source units, it stores normalized selectors and
the hash schema id used to calculate evidence. The ledger can be compacted into
derived projections, but the original event stream remains append-only.

### Derived State

Release/status state is derived from the event ledger, current source inventory,
and locks. `.skillset/changes/state.json` is compatibility/cache output, not an
authoring surface. Reconstructible facts are recomputed from ledger and source
evidence; gaps that still depend on legacy baseline state fail loudly. This ADR
does not claim full cache reconstruction. ADR-0025 defines the exact
`baseline.recorded` evidence contract without claiming its implementation.

The cache shape should separate:

- release baselines: scope, version, source hash, hash schema, and tombstones;
- pending coverage: reason id to current source selectors and hashes;
- diagnostics cache: expensive status/explain facts that can be dropped;
- migration metadata: cache schema version and source event range.

Only release baselines are semantically durable. Pending coverage and diagnostics
are rebuildable conveniences.

### Changelog Projections

Entity `CHANGELOG.md` files remain generated tracked projections beside the
source entity they describe. They render applied release history, not pending
sections. Pending wording changes update the reason source before release; after
release, amendments append ledger events and generated changelogs render the
latest correction while preserving original events.

The `changes.changelog` configuration defaults to tracked generated
entity-local changelogs. Alternate projection paths are allowed only as explicit
configuration for repos that already own `CHANGELOG.md` with another release
tool.

### Compatibility And Migration

Existing frontmatter-backed pending entries remain compatibility input through
the explicit `skillset change migrate --yes` boundary. New commands write the
reason-only shape; mixed or incomplete legacy state fails loudly rather than
becoming alternate source truth.

`.changeset/` stays separate. Changesets records package-facing npm release
intent for the `skillset` packages; Skillset's change ledger records workspace
source-unit reasons and generated entity changelogs.

## Implementation Evidence

Schema-versioned ledger parsing covers reason, coverage, ignore, release,
amendment, and baseline events. `change add` and `change reason` write human
reason sources while machine-owned evidence enters the ledger. Release and
status readers derive current facts where evidence is sufficient, and explicit
migration handles legacy frontmatter. Focused change-ledger, migration,
refresh, ignore, release, and concurrency tests pin these boundaries.

## Consequences

This removes a major source of authoring ceremony and gives Skillset one durable
event model for status, release, changelog, and baseline decisions. It also makes
the state/cache boundary clearer: authors commit reasons and ledgers; generated
locks and rebuildable caches can be refreshed mechanically.

The tradeoff is migration complexity. Old pending-entry files need compatibility
readers, and explicit migration must not lose audit data while moving ids and
hashes out of hand-authored frontmatter.

## Acceptance Evidence (2026-07-20)

The cutover described above is implemented. The ledger accepts eight
schema-versioned event types: `reason.created`, `reason.updated`,
`change.covered`, `change.ignored`, `release.applied`, `change.amended`,
`release.amended`, and `baseline.recorded`. Reason-only Markdown is the authored
surface; generated ids, hashes, coverage, release facts, locking/fencing, and
replan evidence are machine-owned. Compatibility readers and explicit migration
remain supported boundaries rather than alternate source truth.

SET-329 and SET-330 add the current refresh, ignore, lock ownership, heartbeat,
fencing, stale-owner recovery, and replan-before-append guarantees. This ADR
does not claim every compatibility cache is already reconstructible. ADR-0025
settles the meaning of `baseline.recorded` as exact whole-inventory
migration/adoption evidence, but the permissive parser remains a placeholder;
no conforming writer or replay path is claimed here. This accepted record
narrowly amends the broad provenance model without replacing it.

## References

- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) -
  source truth versus generated output.
- [Source Change, Release, and Dependency Provenance](0014-source-change-release-provenance.md) -
  current implemented source-change model.
- [Change and Release Edge Decisions](0016-change-release-edge-decisions.md) -
  compact ids, group semantics, and release-tool interop.
- [ADR-0025: Baseline Records Are Evidence Bridges](0025-baseline-record-evidence-bridges.md) -
  exact baseline record/replay semantics and authority exclusions.

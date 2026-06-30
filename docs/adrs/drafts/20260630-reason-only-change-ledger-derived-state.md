---
slug: reason-only-change-ledger-derived-state
title: Reason-Only Change Ledger and Derived State
status: draft
created: 2026-06-30
updated: 2026-06-30
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, source-change-release-provenance, change-release-edge-decisions]
---

# ADR: Reason-Only Change Ledger and Derived State

Status: design (SET-204). This records the intended cutover away from
hand-authored pending-entry frontmatter. Current v1 behavior remains documented
in the feature pages until the implementation slices below land.

## Context

The current change and release implementation works, but it exposes too much
machine structure as the authoring surface. Pending changes are Markdown files
under `.skillset/changes/` with YAML frontmatter for `id`, `scope`, `bump`,
`group`, and source-hash evidence. Release apply then consumes those files into
`history.jsonl`, appends `releases.jsonl`, writes mutable `state.json`, and
refreshes generated entity `CHANGELOG.md` projections.

That shape proved the source-change workflow, but it has three design problems:

- authors have to care about fields that should be derived from source status;
- generated ids, hashes, and release baselines can look like source truth;
- changelog wording, durable release events, and rebuildable status/cache state
  are mixed together in one mental model.

The desired authoring flow is reason-first: an author should explain why a
change exists, optionally choose a bump or group, and let Skillset normalize the
rest from current source inventory, release baselines, and command context.

## Decision

Adopt a reason-only authoring model backed by a normalized event ledger and
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

The exact syntax can be a small Markdown convention or a CLI-managed sidecar, but
the principle is fixed: humans author reason text and high-level intent; Skillset
owns generated ids, current source hashes, normalized selectors, and release
evidence.

### Normalized Ledger

`.skillset/changes/ledger.jsonl` becomes the durable append-only event stream.
Events are machine-written JSON records with stable schema versions. They record
what happened, not what the user must maintain by hand.

The v1 event set should cover:

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
and locks. The durable cache may still live under `.skillset/changes/state.json`
for compatibility during the cutover, but it is not an authoring surface and
should become rebuildable. If the cache is missing or stale, Skillset should be
able to recompute it from `ledger.jsonl`, source files, and `skillset.lock`
records. If recomputation is impossible because old events lack required data,
the CLI should fail loudly and ask for an explicit baseline event.

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

The `changes.changelog` configuration should default to tracked generated
entity-local changelogs. Alternate projection paths are allowed only as explicit
configuration for repos that already own `CHANGELOG.md` with another release
tool.

### Compatibility And Migration

The existing frontmatter-backed pending entries remain a compatibility input
until the cutover lands. The migration should read old `.skillset/changes/*.md`
entries, write equivalent reason and ledger events, and leave the old files
untouched unless the user explicitly runs a cleanup command. New commands should
write the reason-only shape once the cutover branch lands.

`.changeset/` stays separate. Changesets records package-facing npm release
intent for the `skillset` packages; Skillset's change ledger records workspace
source-unit reasons and generated entity changelogs.

## Implementation Split

1. Define ledger event types and readers. Add schema-versioned parsing for
   `ledger.jsonl`, plus fixtures for pending reasons, release apply, amendments,
   ignored entries, and baselines.
2. Add reason-only pending entry authoring. Teach `skillset change add` and
   `skillset change reason` to write human reason sources while deriving ids,
   scopes, source hashes, and bump suggestions.
3. Derive state from ledger events. Rebuild release baselines and pending
   coverage from the ledger, then treat `state.json` as cache/compatibility
   output instead of hand-authored source truth.
4. Cut over docs, schema references, and generated examples. Retire the pending
   change-entry frontmatter contract from user-facing docs once commands no
   longer write it.
5. Add migration/compatibility checks. `skillset change check` should explain
   old frontmatter entries, offer the migration path, and reject mixed ambiguous
   state once the compatibility window closes.

## Consequences

This removes a major source of authoring ceremony and gives Skillset one durable
event model for status, release, changelog, and baseline decisions. It also makes
the state/cache boundary clearer: authors commit reasons and ledgers; generated
locks and rebuildable caches can be refreshed mechanically.

The tradeoff is migration complexity. Old pending-entry files need compatibility
readers, and the first implementation must be careful not to lose audit data
while moving ids and hashes out of hand-authored frontmatter.

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) -
  source truth versus generated output.
- [Source Change, Release, and Dependency Provenance](20260609-source-change-release-provenance.md) -
  current implemented source-change model.
- [Change and Release Edge Decisions](20260609-change-release-edge-decisions.md) -
  compact ids, group semantics, baselines, and release-tool interop.

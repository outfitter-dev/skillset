---
id: 25
slug: baseline-record-evidence-bridges
title: Baseline Records Are Evidence Bridges
status: accepted
created: 2026-07-21
updated: 2026-07-21
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 14, 15, 16]
amends: [14, 15, 16]
---

# ADR-0025: Baseline Records Are Evidence Bridges

## Context

The reason-only change ledger reserves `baseline.recorded`, but the accepted
records deliberately left its meaning unresolved. The parser currently accepts
a permissive placeholder payload: optional reason text and one or more source
units. That shape proves only that the event vocabulary is parseable. It is not
enough to distinguish an intentional adoption boundary from a hash-algorithm
cutover, prove that the record covers the whole inventory, or replay the event
without silently discarding source changes.

A baseline event is especially risky because ordinary change and release events
have visible author intent. Treating an incomplete baseline as coverage, ignore,
or release authority would make drift disappear without a reason entry. Treating
a partial inventory as a migration boundary would silently reset every omitted
unit.

## Decision

`baseline.recorded` is an immutable, append-only evidence bridge for exactly two
operations: an exact hash-schema migration or an explicit workspace adoption.
It is never an ordinary authoring shortcut.

### Complete Evidence Is Mandatory

A conforming payload must contain:

- a non-empty machine-stable `kind` that is exactly `hash-schema-migration` or
  `adoption`;
- a non-empty human-readable `reason` explaining the migration or adoption;
- `digestSchema: skillset-baseline-inventory-v1` and a `currentDigest`
  calculated from the complete normalized current inventory;
- one `current` tuple for every source unit, each containing the exact normalized
  selector, hash-schema id, and source hash used by the current inventory; and
- operation-specific evidence: `hash-schema-migration` requires one `prior`
  tuple for every current selector plus a `priorDigest`, while `adoption`
  requires an immutable `adoptionPlanId` identifying the explicitly reviewed
  plan that approved this exact current inventory.

Selectors must be unique and strictly sorted after normalization. A migration's
`prior` and `current` selector sets must be identical. Adoption has no invented
prior state: it records only the explicitly adopted current inventory. Each
digest anchors the whole ordered tuple set, not a caller-selected subset or a
summary assembled from stale cache state.

### Digests Have One Versioned Encoding

`skillset-baseline-inventory-v1` computes a digest as lowercase
`sha256:<64-hex-digits>` over the exact UTF-8 bytes of one JSON object. The
object has no whitespace or trailing newline, its fields appear in the fixed
order `schema`, `units`, and every unit has fields in the fixed order
`selector`, `hashSchema`, `sourceHash`. `schema` is exactly
`skillset-baseline-inventory-v1`. `units` contains the complete tuple array
sorted by normalized selector's UTF-8 byte sequence. Strings use the normal
JSON escaping rules; implementations must not pretty-print or add fields to the
hashed representation.

For example, these exact bytes:

```json
{"schema":"skillset-baseline-inventory-v1","units":[{"selector":"skill:demo","hashSchema":"skillset-source-unit-v2","sourceHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}
```

produce:

```text
sha256:3e5bba3ce15b78196f2a8f0e0367cbe22152107592bd3d642ec3911452b3085c
```

`currentDigest` hashes the `current` tuples. A hash-schema migration's
`priorDigest` hashes the `prior` tuples using the same digest schema. A future
digest encoding requires a new digest-schema id; readers must not guess or
silently reinterpret an unknown version.

### Recording Uses One Locked Source Snapshot

A hash-schema migration captures both tuple sets while holding the same
exclusive workspace/ledger lock over one unchanged source snapshot. It computes
each unit's `prior` and `current` hashes from the same source bytes under the old
and new hash schemas. A content edit between captures invalidates the plan; the
writer must replan rather than bridge real source drift as a schema change.

Adoption is eligible only through an explicit, reviewed initial/adoption plan
whose recorded plan identity covers the same `current` tuples and digest. At
append time, under the exclusive workspace/ledger lock, the writer must rebuild
the complete inventory from the unchanged source snapshot and prove it still
exactly matches that reviewed plan. Adoption is refused when any prior baseline
or release baseline/history applies, when pending reason/coverage/ignore
evidence exists, or when any available prior comparison reports uncovered
source drift. Those states require the ordinary change/release flow or an exact
hash-schema migration; adoption cannot erase them.

Unknown kinds, unknown hash schemas, missing or duplicate selectors, unsorted
tuples, incomplete inventories, mismatched migration selector sets, digest
mismatches, and conflicting records fail loudly. Readers must not repair,
coerce, merge, or partially apply invalid evidence.

### Replay Requires An Exact Match

A reader may replay a baseline prospectively only after deriving the complete
live inventory and proving an exact match with the record's `current` tuple set
and `currentDigest`. Exact means the same normalized selectors, hash-schema ids,
source hashes, order, and digest. If any unit was added, removed, renamed, or
changed, the record supplies no partial baseline and normal change evidence must
account for the difference.

For a hash-schema migration, replay may carry an existing baseline across the
schema boundary only when that baseline exactly matches the complete `prior`
tuples and `priorDigest`, and the live inventory exactly matches `current`.
Those tuples explain one same-snapshot old-to-current identity bridge; they do
not authorize later schema conversions.

Adoption has no retrospective replay effect: it does not transform prior events,
resolve pending evidence, or make earlier unexplained drift covered. Its exact
current tuples establish only the future comparison anchor after the reviewed
adoption event. Events remain append-only, so a later migration or independently
eligible adoption requires a new complete record rather than amending an earlier
one.

### Baselines Have No Change Or Release Authority

A baseline record does not create or update a reason, cover or ignore a change,
select a release, render a changelog entry, choose a bump, or set a version. It
cannot substitute for `reason.*`, `change.covered`, `change.ignored`, or
`release.applied`, and release projections must not infer any of those facts
from it. The record's reason explains the evidence boundary only.

This decision defines the ledger contract, not a command. No public baseline
command or command spelling is authorized. The current permissive parser is an
unimplemented placeholder until a future implementation validates, appends,
and replays the complete contract above atomically and fail-loud.

## Consequences

Hash-schema evolution and explicit adoption gain a durable bridge without
turning cache resets into accepted provenance. Exact whole-inventory evidence
makes replay deterministic and prevents an omitted unit from disappearing.

The cost is deliberate strictness. A source change concurrent with recording,
an incomplete legacy inventory, or evidence from an unknown schema blocks the
operation instead of producing a best-effort baseline. Implementations will
need an under-lock replan before append and exact replay validation afterward;
this ADR does not assign that work to an existing command.

ADR-0014 retains the broad source-change and release provenance model. ADR-0015
retains the reason-only append-only ledger and derived-state boundary. ADR-0016
retains its other edge decisions. This accepted record narrowly amends only
their previously deferred baseline semantics.

## References

- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - source
  truth and fail-loud migration doctrine.
- [ADR-0014: Source Change, Release, and Dependency Provenance](0014-source-change-release-provenance.md) - broad change and release provenance model.
- [ADR-0015: Reason-Only Change Ledger and Derived State](0015-reason-only-change-ledger-derived-state.md) - append-only event vocabulary and derived-state boundary.
- [ADR-0016: Change and Release Edge Decisions](0016-change-release-edge-decisions.md) - accepted edge decisions that deferred this contract.
- [SET-363](https://linear.app/outfitter/issue/SET-363/define-change-baseline-record-semantics) - decision owner; command naming and implementation are excluded.

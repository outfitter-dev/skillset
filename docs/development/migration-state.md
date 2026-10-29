---
description: The versioned workspace migration ledger preserves flag identity, evidence, and explicit review decisions independently of source release hashes.
---

# Migration State

[ADR-0048](../adrs/0048-adoption-is-a-reviewable-migration.md) separates mutable workspace review state from immutable operation reports. The shared `skillset.migration-state@1` contract lives in `@skillset/schema`; its generated [JSON Schema](../reference/schemas/0.1.0/migration-state.schema.json) and [example](../reference/examples/migration-state.json) come from that package. Core owns identity reconciliation and transaction planning. Workbench delegates structural checks to the same validator.

This is the state foundation for the migration lifecycle. It does not add a CLI command, automatically emit or strip inline markers, or enable a readiness gate. Safe marker parsing and semantic hash exclusion belong to SET-436; lifecycle operations and readiness belong to SET-438.

## Record and storage

The workspace snapshot is `.skillset/adopt/state.json`. Each flag carries an ID, diagnostic code, severity, disposition, message, current source location, optional origin, content and context fingerprints, evidence, related immutable report IDs, placement, and ordered decision history. Locations are repository-relative, with optional one-based line and column. Fingerprints are SHA-256 values computed by the producing scanner from the relevant content and surrounding context; they are evidence, not a heuristic similarity score.

Visible labels (`todo`, `fix`), severity (`error`, `warning`, `info`), and review state (`open`, `accepted`, `resolved`) are separate. Inline placement records its label and line. Sidecar placement records why a comment cannot safely be placed; it is a fully typed flag, including for JSON, copied resources, or provider-native material.

An accepted or resolved flag requires a reason and timestamp. Open flags have no current resolution. History retains previous decisions in order when future lifecycle operations replace or reopen a decision. The structural validator does not infer whether a claimed resolution is justified; that requires the lifecycle's evidence checks.

## Identity and complete rescans

Core's `reconcileMigrationState` accepts a ledger and a complete observation set:

1. Validate the shared shape and reject duplicate ledger IDs.
2. Reserve explicit IDs first. An unknown ID is an orphan, and duplicate explicit anchors are errors. Changed code, severity, disposition, fingerprints, message, origin, or supporting evidence under an existing explicit ID produces a stale-evidence error; its prior decision is retained.
3. Match remaining observations using exact content **and** context fingerprints, diagnostic code, severity, and disposition. A match requires one remaining ledger record and one observation. Multiple candidates require explicit anchors; scan order never chooses a winner. A matched observation with changed message, origin, or supporting evidence is also stale and cannot inherit a prior decision. Evidence ordering alone is not a semantic change.
4. Create IDs for unmatched new observations from those semantic attributes plus source and origin locations. Identity is never derived only from a mutable path or line. Those initial occurrence coordinates distinguish repeated content; later relocation uses the retained ID or unique fingerprints.
5. Propose current source/placement updates while retaining original evidence, origin, review decisions, and history. Merge related report IDs. A moved location produces a stale-location warning. A missing observation preserves its ledger record and produces an orphan warning; deleting a marker never resolves it.

Blocking diagnostics return the original state unchanged. Callers must display diagnostics and must not interpret an unchanged ledger as successful acceptance. A missing sidecar observation is also an orphan: callers must include sidecar findings in a complete scan. Partial scans are outside this API's contract.

## Writes and hashes

`readMigrationState` distinguishes an absent snapshot from malformed or unreadable state and refuses existing symlink ancestry. It retains the exact disk bytes. `planMigrationStateWrite` produces one write for the existing workspace transaction, binding either expected absence or those bytes. The transaction checks preimages and containment, preserves concurrent author changes, and rolls back a failed installation. A successful scan does not independently authorize a write.

`hashMigrationState` returns a domain-separated `migration-state:sha256:` identity. Object keys, flags, report-ID sets, and evidence ordering are canonicalized; decision history remains ordered. Review decisions and locations affect this hash. The ledger is outside the enumerated source inventory, so sidecar state changes do not create package-facing source release changes. Inline marker exclusion is deliberately not implemented by this snapshot contract; arbitrary comments are never stripped by a broad regular expression.

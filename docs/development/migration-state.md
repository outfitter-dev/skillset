---
description: The versioned workspace migration ledger preserves flag identity, evidence, and explicit review decisions independently of source release hashes.
---

# Migration State

[ADR-0048](../adrs/0048-adoption-is-a-reviewable-migration.md) separates mutable workspace review state from immutable operation reports. The shared `skillset.migration-state@1` contract lives in `@skillset/schema`; its generated [JSON Schema](../reference/schemas/0.1.0/migration-state.schema.json) and [example](../reference/examples/migration-state.json) come from that package. Core owns identity reconciliation and transaction planning. Workbench delegates structural checks to the same validator.

This is the state and marker foundation for the migration lifecycle. Adaptive source loading validates and removes ledger-owned inline locators before compilation. It does not add a migration CLI command or enable a readiness gate; lifecycle operations, scanner completeness, and status/show presentation remain SET-438 work.

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

An observations array cannot prove its own completeness: an omitted matching observation can make an ambiguous fingerprint appear unique. SET-438's scanner must successfully enumerate and read the full intended source and sidecar set before calling reconciliation. Partial or errored scans block reconciliation, persistence, and readiness; preserving unobserved ledger records alone does not establish a complete scan.

## Writes and hashes

`readMigrationState` distinguishes an absent snapshot from malformed or unreadable state and refuses existing symlink ancestry. It retains the exact disk bytes. `planMigrationStateWrite` produces one write for the existing workspace transaction, binding either expected absence or those bytes. The transaction checks preimages and containment, preserves concurrent author changes, and rolls back a failed installation. A successful scan does not independently authorize a write.

`hashMigrationState` returns a domain-separated `migration-state:sha256:` identity. Object keys, flags, report-ID sets, and evidence ordering are canonicalized; decision history remains ordered. Review decisions and locations affect this hash. The ledger is outside the enumerated source inventory, so sidecar state changes do not create package-facing source release changes. Inline locators are excluded through the validated source-loading boundary described below; arbitrary comments are never stripped by a broad regular expression.


## Inline marker grammar and ownership

Schema owns the exact single-line comment form:

```markdown
<!-- skillset:todo ::: #adopt-k3m9 [ambiguous-reference] Review the authored reference. -->
```

The label is `todo` or `fix`. IDs and diagnostic codes use the migration-state contract. Message text must be nonempty, trimmed, and representable in one HTML comment: control characters, line breaks, and `--` are refused. Grammar recognition alone grants no removal authority.

Core requires an exact ledger match for the ID, source path, placement line, label, diagnostic code, and message. A missing record, duplicate anchor, malformed reserved comment, or disagreement fails source loading with an authored-path/line diagnostic. Every inline ledger record must occur in a loaded adaptive source, including draft skills. Missing anchors never resolve a flag, and this source-loading check does not establish the complete sidecar scan required by the future lifecycle.

Only standalone top-level HTML comment blocks are locators. Fenced and inline code examples and unrelated comments remain authored content. Frontmatter, tables, list interiors, quoted blocks, copied resources, partials, provider-native islands, JSON, binary material, and native root `AGENTS.md` cannot receive inline anchors. Those findings use a sidecar record with a deterministic reason. A locator that the ledger expects in one of those contexts fails validation rather than acquiring ownership through its spelling.

`planMigrationMarker` is a read-only insertion plan for a top-level paragraph, heading, or complete list boundary. It preserves source line endings and returns sidecar placement when the location or message is unsafe. It does not write source or state. Its caller must account for shifted existing locations and commit source plus ledger together through the existing transaction boundary; the migration lifecycle owns that operation.

## Semantic source and diagnostics

The resolver removes validated marker lines before preprocessing or transform recognition for rules, standalone and plugin skills, and project agents. Adjacent text and whitespace are preserved. Rule and agent hashes consume the semantic body; skill hashes substitute the exact marker-free primary `SKILL.md` bytes while retaining raw companion/resource bytes. Provider output, output hashes, and release-source hashes therefore match the equivalent unannotated source. Review state retains its separate hash.

Deleting lines changes semantic coordinates, so marked sources retain a semantic-body-to-authored-line map. Workbench callers can provide the same validated `migrationState` snapshot to document parsing or source-contract checks; diagnostics and headings are mapped back to authored lines and annotation prose is excluded from Markdown checks. Without a snapshot, Workbench retains the ordinary authored-document behavior and does not infer marker ownership.

Reverse reconciliation refuses to replace an annotated source body from generated output because that would discard locators. Source moves and renames that would leave the ledger inconsistent fail their projected-graph validation. Edit source and migration state together through the lifecycle when that workflow becomes available; do not remove comments to imply that review is complete.

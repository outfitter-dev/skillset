---
id: 48
slug: adoption-is-a-reviewable-migration
title: Adoption Is a Reviewable Migration
status: accepted
created: 2026-10-29
updated: 2026-10-29
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 9, 18, 22, 23, 24, 33, 43, 47]
amends: [22, 24]
---

# ADR-0048: Adoption Is a Reviewable Migration

## Context

Repository adoption can finish its import, lint and isolated build stages without proving that the source preserves the original intent. The guided-adoption design records external fixtures that exposed ambiguous mentions, invented provider paths, omitted runtime dependencies, widened curated skill selection and conflicting provider discovery metadata. Command success alone cannot distinguish these from a faithful migration.

The original compound-engineering fixture in ADR-0024 retained 197 of 243 files byte-identically while leaving recognized surfaces and metadata behind. That is historical coverage evidence, not a current semantic pass rate. The guided-adoption investigation also names `disable-model-invocation` in emilkowalski-skills, `allowed-tools` and `user-invocable` in last30days, and Claude hook variables as cases requiring capability and fidelity judgments. Raw counts or a plausible target spelling do not settle them. SET-433 owns the exact-revision audit and remediation evidence; SET-444 owns semantic fixture gates.

Matt accepted SET-437's architecture on October 28. Its named August draft is absent from the current checkout and available Git history, so this record reconstructs the decision from the accepted issue and its Linear design document. It does not pretend to promote an inspected draft. The September authoring-model decision and October native-root decision constrain the resulting command and source boundaries.

## Decision

Repository adoption is a reviewable migration. One action may create the best representable workspace, but operation completion and migration readiness are separate facts. This is an accepted target contract, not a claim that the migration ledger, flags or lifecycle already ship.

### Classify meaning and preserve uncertainty

Every recognized construct receives a disposition with evidence:

| Disposition | Required behavior |
| --- | --- |
| Proven normalization | Convert only an exact semantic match supported by source and destination contracts; record the change and evidence. |
| Ambiguous meaning | Preserve bytes and create a review flag; absent or stale evidence is unknown. |
| Provider-native behavior | Preserve within the provider boundary; request review or explicit acceptance when needed. |
| Lossy or unsupported behavior | Keep explicit render/adoption results and block readiness where unresolved human action matters. |
| Omitted dependency or scope | Flag missing runtime dependencies or widened/narrowed curated scope with blocking evidence. |

For a positive production normalization, recognized plugin manifest identity fields such as `name` and `description` retain their string values through canonical plugin configuration and back into the same provider manifest. That exact metadata mapping authorizes no unrelated body rewrite. For a positive transform control, an explicitly defined synthetic source-intent protocol can map to its defined target-intent counterpart. That proves engine dispatch only. A production normalization, including a recognized runtime variable, also needs evidence for the exact accepted token and destination behavior. `${CLAUDE_PLUGIN_ROOT}` is not evidence that a longer identifier such as `$CLAUDE_PLUGIN_ROOTED` has the same meaning.

Negative examples remain literal: social `@alice`, CSS `@media`, decorators, scoped package names, fenced examples and prose comparing `CLAUDE.md` with `AGENTS.md`. Replacing a `.claude/` prefix with `.codex/` can invent an unsupported marketplace path even when the substitution reverses perfectly. One recognized span must never authorize unrelated whole-document transformation. Target-specific procedures need a faithful typed adapter or stay native.

This specializes the [meaning-before-syntax tenet](../project/tenets.md#recognize-meaning-before-rewriting-syntax) and the [transform review contract](../../CONTRIBUTING.md). It does not relax unsupported-output policy or convert an evidence gap into a portability claim.

### Separate migration flags, render results and release records

A migration flag is a durable unresolved authoring decision. It records stable identity, diagnostic code, severity, state, disposition, source/origin locations, content/context fingerprints, evidence, related report ids and resolution or acceptance history. SET-446 owns the versioned shape in `@skillset/schema`; CLI, compiler, Workbench and reports consume that shape rather than inventing field lists.

ADR-0018 render results still describe a particular source unit's output for a destination. A flag may cite those results, but neither replaces the other. Source change entries and their release ledgers still record source-unit release intent; package Changesets separately record published-package changes. Marker-only migration state does not become either kind of release record.

Safe Markdown may carry an exact validated migration anchor beside questionable content. Inline comments are locators, never authoritative state. Frontmatter, fences, tables, JSON, binary files, copied resources and provider-native islands remain sidecar-only. Strip only validated migration markers before semantic preprocessing, hashing and transformation; preserve all adjacent authored content. Deleting a marker does not resolve an open record. IDs survive moves through explicit identity first and credible content/context matching second; ambiguous matches remain unresolved. SET-436 owns placement and stripping after SET-446 defines the contract.

### Give each storage surface one owner

| Material | Owner and boundary |
| --- | --- |
| Authored units and source choice | Root `skillset.yaml` and `.skillset/` under ADR-0033; native root `AGENTS.md` under ADR-0047. |
| Active migration state | `.skillset/adopt/`, the accepted source-adjacent boundary owned by SET-446. The `migrate` command name does not silently rename this path. |
| Inline locators | Safe canonical source locations; the workspace ledger remains authoritative. |
| Immutable operational evidence | ADR-0043 user-global `$XDG_STATE_HOME/skillset/reports/<report-id>/` bundles. |
| Clones, downloads and provisional projections | Rebuildable XDG cache under ADR-0009, including logical `.skillset/cache/latest/`. |
| Recovery material | Repository-local `.skillset/snapshots/`, under explicit recovery authority. |
| Provider output and provenance | Configured repository destinations and nearby locks; no migration markers in emitted artifacts. |

Reports retain their UUID identity and versioned `skillset.report@1` envelope. A report captures an operation and the readiness observed then; it is not the mutable current ledger. Report expiry and pruning remain outside this decision.

### Keep command ownership unambiguous

| Surface | Responsibility |
| --- | --- |
| `init` / `create` | Establish a workspace; current repository onboarding through `init --adopt` remains until a separately implemented cutover. |
| Unmanaged-skill `adopt` | SET-563's future operation for bringing unmanaged skills into authored source and replacing originals with managed output under its safety contract. It is not the repository review lifecycle. |
| Repository `migrate` | SET-438's future review lifecycle: inspect flags, resolve demonstrated fixes and accept explicit residual decisions with reasons. It uses this name from its first release. |
| `import` | Repeated conversion of selected local assets into source, with provenance and diagnostics. |
| `update` | Registered source-preserving provider/compiler format migrations. |
| `reconcile` | Explicit source/output conflict resolution; no blanket migration acceptance. |
| `status` | First-contact workspace conclusion and a route to detailed migration review. |
| `check` | Authoritative readiness gate; unresolved blocking migration flags fail readiness. |
| `report show` | Retrieve immutable historical evidence by report id or supported path. |

Provisional isolated builds remain available to inspect a migration that needs review. A completed operation can report `review_required`; this is not a migration pass. Structured output keeps ADR-0023's finite envelope, truthful write inventory and negative-result semantics. The future lifecycle schema must expose completion and readiness independently instead of overloading a single success flag.

SET-440 owns any remaining legacy entry-point, state and report cutover after the lifecycle exists. Do not temporarily ship repository migration as `adopt`, rename unmanaged-skill adoption, or make the whole migration project a prerequisite for SET-563. Current onboarding remains supported during this sequencing.

### Preserve source and cutover authority

Original provider trees stay unchanged while source and isolated projections are reviewed. Unmanaged root `AGENTS.md` follows ADR-0047: retain it as authored source and persist native mode. Root `CLAUDE.md` and `.claude/CLAUDE.md` are preserved provider guidance, never native sources; an agent can help the author synthesize a reviewed `RULES.md` and make an explicit source-mode transition. The compiler does not rank prose quality.

A migration flag or successful isolated build never authorizes overwriting unmanaged output. Review the complete live collision inventory, preserve originals recoverably, and use the existing explicit cutover/recovery workflow. Invalid locks or failed inspection leave cutover unknown rather than declaring it safe. Activation, trust, installation and publication remain separate from compilation.

### Amendments and implementation sequencing

This record narrowly amends ADR-0022's rejection of a repository lifecycle domain and ADR-0024's one-action completion framing. Their historical evidence remains unchanged. It adds the durable review state and readiness distinction while preserving repo-local onboarding, original-tree purity and isolated projection.

ADR-0009's source-adjacent state rule accommodates the migration ledger; ADR-0018 still owns render results, ADR-0023 the command envelope, ADR-0033 the workspace layout, ADR-0043 global reports, and ADR-0047 native root guidance. No parallel report store, provider output tree or source layout is introduced.

Implement in dependent slices: SET-446 schema/state, SET-436 safe anchors, SET-442 classifications, SET-438 lifecycle/readiness and SET-440 legacy cutover. SET-447 supplies the evidence-backed capability crosswalk; SET-439 and SET-444 cover omitted dependencies/scope and semantic fixture gates. Global reports are already delivered under ADR-0043. Acceptance of this ADR does not mark these runtime issues complete.

## Consequences

Authors can distinguish an operationally completed import from a migration that is ready to use. Ambiguity stays inspectable, original trees remain usable for comparison, and agents can follow durable decisions across file movement.

The cost is an explicit review state and identity/reconciliation contract. A finite negative corpus and provider snapshots cannot prove every repository semantically faithful; evidence limitations and blocking uncertainty remain visible. Tests must cover both accepted examples and nearby collisions, preserve original-tree purity, and classify fixture differences rather than equating pipeline success with fidelity.

### What This Does NOT Decide

- Automatic activation, installation, runtime trust, publication or live cutover.
- Upstream refresh, merge or synchronization of hand-edited adopted source.
- Report expiry, pruning, global mutable report indexes or new report identities.
- New source fields, exact flag schema/marker grammar, or a second release-change ledger.
- Portable support for unknown provider features, or execution/runtime effectiveness from static conformance.

## References

- [ADR-0009](0009-skillset-workspace-layout.md#decision) — workspace and XDG cache boundaries.
- [ADR-0018](0018-render-results.md#decision) — per-build rendering truth.
- [ADR-0022](0022-workflow-oriented-cli.md#onboarding-has-three-explicit-owners) — command ownership, narrowly amended here.
- [ADR-0023](0023-versioned-structured-output-for-cli-automation.md#decision) — finite structured results.
- [ADR-0024](0024-one-action-repo-adoption.md#decision) — historical one-action evidence and original-tree purity, narrowly amended here.
- [ADR-0033](0033-workspace-authoring-model.md#decision) — current source layout.
- [ADR-0043](0043-global-immutable-operational-reports.md#decision) — immutable global evidence.
- [ADR-0047](0047-native-root-agents-md-is-authored-rule-source.md#decision) — native root source exception.
- [SET-437](https://linear.app/outfitter/issue/SET-437) — accepted architecture and sequencing.
- [Guided adoption design](https://linear.app/outfitter/document/guided-adoption-migration-contract-and-execution-plan-cad53f1e2170) — external failure examples and review contract.

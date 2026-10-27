---
id: 45
slug: generated-state-merges-as-plain-text
title: Generated State Merges as Plain Text
status: accepted
created: 2026-10-27
updated: 2026-10-27
owners: ['[galligan](https://github.com/galligan)']
depends_on: [14, 15, 18, 38]
amends: [15, 38]
---

# ADR-0045: Generated State Merges as Plain Text

## Context

Skillset repositories commit [generated output](../glossary.md#generated-output), the `skillset.lock` files beside it, and the change ledger under `<source-root>/changes/`. Parallel and stacked pull requests that change *different* [source units](../glossary.md#source-unit) still conflict, on GitHub and on every local restack. In a two-branch measurement (each branch changes a different skill, rule, and plugin skill and records a change entry; plain `git merge`, no `.gitattributes`), the conflicts were:

- the top-level `provenanceHash` of every `skillset.lock` both branches touched. It is one SHA-256 over the whole lock document (`packages/core/src/lock-provenance.ts`), so it differs on every pair of branches;
- `renderResults` and `items` entries inserted at the same sorted position, and the root `AGENTS.md` aggregate item, when both branches added rules;
- `.skillset/changes/ledger.jsonl`, where both branches append at end of file.

With the whole-document hash removed, four of the six locks merged cleanly and byte-identically to a fresh build. The rest were same-position inserts and aggregate outputs.

The current mitigation does not reach the place the conflicts are seen. `.gitattributes` marks generated output `-merge` and the change streams `merge=union` (SET-601, [ADR-0038](0038-change-ledger-append-order.md)), and `skillset resolve` regenerates conflicted output. GitHub's server-side pull request merge and merge queue do not apply user-defined `.gitattributes` merge settings: a GitHub Support reply (2017) and the open community request [#9288](https://github.com/orgs/community/discussions/9288) (2021 to 2025) say so. That is not officially documented, but nothing contradicts it. So every open pull request conflicts on GitHub, and a stack stops once per branch per shared lock on restack. Every adopting repository would need to learn `skillset resolve` for a conflict that carries no information, which fails [Help the happy path](../project/tenets.md#help-the-happy-path).

SET-598 rejected the obvious fix, a JSONL lock merged with `union`. A whole-document hash always conflicts, and `union` silently duplicates adjacent changed records. It deferred per-record provenance to an ADR. This is that ADR.

## Decision

Generated state is laid out so that an ordinary three-way text merge of two branches that change different source units is clean and correct. A line in a lock or a ledger file belongs to one unit or one event, never to a summary of several. Validation runs after the merge, not inside it.

### Lock schema v5: per-entry provenance

- `schemaVersion: 5` drops the top-level `provenanceHash`.
- A top-level `headerHash` covers the canonical top-level fields except `items`, `renderResults`, and itself. These are configuration- and topology-derived (`target`, `outputRoot`, `sourceRoot`, `selectedTargets`, `selectedStandards`, `standardProfileEvidence`, `features`, `buildMode`, `generatedBy`, `skillsetMetadata`, `marketplaces`). They change only when workspace configuration or the compiler changes, and two branches that change configuration differently should conflict.
- Every `items[]` entry carries its own `provenanceHash` over that entry. Changing one unit rewrites only that entry's lines.
- `renderResults` keep the [ADR-0018](0018-render-results.md) record shape and stay unhashed. They are informational in the lock: every consumer reads render results from a fresh render, and `check` compares the whole lock to a fresh render.
- A lock is trusted exactly when its header hash and every entry hash verify. Every existing caller of lock provenance (`generated-lock.ts`, `build.ts`, `output-safety.ts`, `output-repair-plan.ts`, `render-marketplaces.ts`, `render-project-hooks.ts`) already makes a whole-lock or per-entry trust decision, so each keeps its meaning.
- The hashes are checksums, not signatures. Anyone with the CLI can recompute them, so they detect accidents, not adversaries, as before. The one thing the whole-document hash caught that entry hashes do not is an entry removed whole by hand. A removed entry makes its paths unmanaged, and the build then refuses to overwrite them as an unmanaged collision. That is the fail-safe direction.
- A v4 lock with a valid document hash is accepted as trusted provenance for its v5 rewrite. The next `build --yes` writes v5. Pre-v4 locks keep their rebuild-only path.

### Pending ledger events live in their own files

- Ordinary change commands (`change add`, `reason`, `refresh`, `ignore`, `migrate`, and the applying `draft`, `promote`, `move`, and `new` lifecycle writes) no longer append to `ledger.jsonl`. Each mutation writes one new file, `<source-root>/changes/events/<stamp>-<id>.jsonl`. It holds that mutation's records in order, in the existing record shape.
- `<stamp>` is the mutation's `createdAt` in compact UTC form (`YYYYMMDDTHHMMSSmmmZ`, valid on every filesystem), and `<id>` is its first record id. Writers keep ADR-0038's stamp rule, `max(now, latest)`, where latest now spans `ledger.jsonl` and pending files.
- The fold order is `ledger.jsonl` in file order (unchanged from ADR-0038), then pending files in file-name order, then records in line order. Two branches add two different files, which git merges without conflict, and their order after merge does not depend on which side merged first.
- Rollback deletes the mutation's own file instead of removing its lines.
- `release apply` appends the pending records to `ledger.jsonl` in fold order and deletes the pending files, in the same transaction that writes the release. A pending file that reaches trunk after a release is still pending, which is what it is.
- `ledger.jsonl`, `history.jsonl`, and `releases.jsonl` remain append-only, file-ordered trunk streams, and the trunk-prefix guard keeps checking them. Only `release apply` writes them in ordinary operation (amendment streams, written by `change amend` and `release amend` against applied history, stay as they are), so ordinary pull requests no longer touch them. That removes the reason for "never merge trunk into a branch" for those pull requests.

This amends [ADR-0038](0038-change-ledger-append-order.md). File order stays authoritative for the trunk streams, and pending events get a merge-independent order of their own. It also amends [ADR-0015](0015-reason-only-change-ledger-derived-state.md#normalized-ledger)'s single-stream layout.

### No merge attributes for generated state

- Generated output and locks merge as ordinary text, and `.gitattributes` no longer marks them `-merge`. A clean text merge of entries that each belong to one unit is the merged render. When it is not (a render that depends on two units both branches changed), the dependent entry's hashes change on both sides, so git conflicts. If a clean merge is ever wrong anyway, `skillset check --ci` on the pull request head and on the merge-queue candidate rejects it.
- Lock readers fail closed on conflict markers, because a lock with markers is not valid JSON.
- `skillset resolve` remains the command for true conflicts, where both sides changed the same unit.
- `skillset init` writes no `.gitattributes`. Adopting repositories get the merge behavior from the file layout, not from per-repository configuration.

### Accepted residual conflicts

Some cases still conflict and are real:

- two branches change the same unit;
- two branches change configuration;
- two branches insert units that sort into the same position of one lock;
- two branches change contributors to one aggregate output, such as the root `AGENTS.md`.

These are the cases where a person or `skillset resolve` should look.

## Consequences

### Positive

- Parallel and stacked pull requests that touch different units merge on GitHub, through the merge queue, and on local restack with no conflict and no extra command, for every adopting repository and with no setup.
- Lock diffs get smaller and attributable: one unit's change shows as that entry's lines.
- The ledger keeps one deterministic fold, and the trunk streams keep their prefix guarantee.

### Tradeoffs

- The lock schema changes (v5). Readers outside this repository that validated the document hash must move to entry and header hashes. The lock is public, so this needs a Changeset and migration notes.
- Detection of a hand-removed lock entry moves from the provenance check to the unmanaged-collision check and `check`'s comparison against a fresh render.
- Pending event files accumulate between releases. A repository that never releases keeps one small file per mutation.
- Same-position inserts and aggregate outputs still conflict. Removing those would need one file per unit, which was considered and deferred below.
- A mixed-compiler merge (branches built by different `generatedBy` versions) now conflicts on the header rather than on every entry, and `check` reports drift after the merge.

### What This Does NOT Decide

- **One file per lock entry** (sharded locks). It removes same-position insert conflicts but adds a directory per output root and a new on-disk convention. Deferred until measured residual conflicts justify it.
- **Splitting aggregate outputs** such as the root `AGENTS.md` into per-rule files. That is a provider-layout question governed by each provider's contract.
- **A conflict-clearing CI job** that regenerates conflicted pull requests automatically. It may be useful later, but this decision should make it rarely necessary.

## References

- [Tenets](../project/tenets.md) - "Help the happy path", "Generated output is reproducible", "Provenance stays inspectable", and "Drift becomes visible early" govern this decision.
- [ADR-0014: Source Change, Release, and Dependency Provenance](0014-source-change-release-provenance.md) - locks record output hashes. This ADR changes how those records are hashed, not what they record.
- [ADR-0015: Reason-Only Change Ledger and Derived State](0015-reason-only-change-ledger-derived-state.md#normalized-ledger) - amended. The ledger becomes a trunk stream plus pending event files.
- [ADR-0018: Render Results](0018-render-results.md) - record shape unchanged. The lock copy stays informational.
- [ADR-0038: Change Ledger Append Order Is Authoritative](0038-change-ledger-append-order.md) - amended. File order stays authoritative for trunk streams, and pending events order by file name.
- [Generated Output Merge Safety](../development/features/generated-output-merge-safety.md) - records the SET-598 investigation this decision resolves.

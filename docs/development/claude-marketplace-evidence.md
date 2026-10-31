---
description: Maintainer ownership, qualification and drift checks for Claude marketplace offline conformance evidence.
---

# Claude Marketplace Evidence

The registry owns the nested marketplace evidence in `packages/registry/src/claude-marketplace-evidence.ts`, the rule ledger in `claude-marketplace-rules.ts`, and the shared inventories in `claude-marketplace-inventories.ts`. Core consumes the field and source inventories. Its algorithms live in `packages/core/src/claude-format-conformance.ts` and the focused `claude-marketplace-entry-fields.ts` helper. The `marketplaces` feature links this evidence specifically to `claude-marketplace-schema`; it is not a standalone plugin-format overlay. The link is maintenance metadata on feature support, rather than additional rendering provenance, so it does not rewrite generated lock bytes.

Each rule group names its local implementation owners, exact predicate and provenance qualification. A nonempty `schema` list retains JSON pointers and values from the recorded SchemaStore source hash. Those facts establish what that third-party schema says. They do not establish behavior in an installed Claude version. An empty list without a `parser` reference means external authority remains unresolved; related local tests do not turn that gap into provider proof. The existing hosted exact-provider validation lane remains the runtime backstop.

## Maintenance

Run `bun run providers:check` or `bun run providers:diff` to fetch the selected schema sources. The marketplace evidence inspects the same fetched bytes as the schema snapshot check. It reports changed pointer values, source-hash drift, the affected schema rule IDs and the unresolved rules requiring manual review. A schema refresh cannot silently refresh this separate evidence record: a subsequent check still fails until its changed facts and qualifications are reviewed.

`providers:update` updates schema snapshots only. Review the corresponding evidence, provider documentation and relevant tests before deliberately editing the rule ledger. Retain unresolved qualifications when a precise source or version is unavailable. Never broaden the compiler contract just to match rolling documentation.

## Static Parser Qualification

`claude-marketplace-parser-evidence.ts` records the existing validation lane's Claude 2.1.269 Linux archive integrity, its exact `package/claude` member digest, and zero-based byte windows with exclusive ends. It qualifies the archive SHA-256 string format, command-source mode/timeout/text limits, and the entry-name strict-validation condition. Each predicate records its stage: `schema-predicate`, `strict-warning` or `validator-error`. Schema predicates retain their source-schema use sites; entry recovery means they do not independently establish CLI exit status. The name record traces the exported validation handler through marketplace dispatch, the name-pattern warning, and the strict aggregation policy. A mismatching nonempty name produces a Claude Desktop compatibility warning, which fails under `--strict`; it is not ordinary Claude Code runtime rejection. Core retains its existing invalid-shape diagnostic. Static tracing does not establish observed execution, whole-command acceptance, installation or runtime behavior.

Provider maintenance reports static rules separately from schema-backed and unresolved rules. It checks that the recorded version, lane identity and archive integrity still match the canonical validation lane. A pin change makes `providers:check` fail pending evidence review. It does not download or execute the binary during ordinary maintenance.

To reproduce byte identity, acquire the exact archive named in the record, verify its recorded integrity, and extract only its regular `package/claude` member into a disposable location without executable permissions. Then run:

```bash
bun scripts/verify-claude-marketplace-parser.ts /path/to/extracted/member
```

This command reads the member and checks its length, full digest and every referenced window. It never invokes provider code. Passing byte checks identifies the inspected bytes; it does not independently prove the human interpretation of them. Review the predicate and its call sites before changing the record or its coverage fingerprint.

The archive-host predicate remains unresolved: the inspected provider guard rejects additional host forms, and static tracing alone does not change the offline validation contract. The qualified name predicate agrees with the specific strict warning condition while retaining the diagnostic-severity distinction above.

## Implementation Coverage

The focused `claude-marketplace-coverage.test.ts` suite checks a reviewed declaration manifest under Core's test fixtures. It detects changed inline conditions, new or missing declarations, import changes and changes to the declared helper boundary. Shared field validation and the hook validator, capability projection and existing hook evidence are included. The hook dependency boundary deliberately covers entire modules, including other providers; this can require review for changes that do not affect Claude.

Fingerprints are change-review tripwires, not semantic proofs or an inferred TypeScript call graph. Every local rule ID must be associated with a reviewed declaration or dependency. Before updating a fingerprint, inspect the affected predicates, their evidence and the conformance corpus. Do not refresh fingerprints merely to clear a failure. The existing provider-format tests exercise accepted and rejected marketplace forms, and deterministic/self-hosted checks verify output stability.

This record preserves current offline validation behavior. Several stricter predicates still have unresolved runtime or version provenance; they remain visible follow-up work and do not become a beta readiness gate.

The duplicate-name rule records the pinned validator's post-parse exact-name comparison and error path. Core reports each later duplicate against its first occurrence; the provider code reports every member of the duplicate group. This is offline conformance evidence, with no provider execution claim.

The metadata closed-key record matches `pluginRoot`, `version` and `description` on the pinned strict-warning path. The rename record qualifies only optional object member values of string or null on the validator error path; the base loader catches invalid renames, and extra chain/target checks remain separate. The 35-key plugin-entry inventory now matches the inspected parser composition, including `binaries`. Unknown keys follow a strict-warning path; key parity does not establish value or runtime parity.

### Marketplace archive headers

Offline Claude marketplace conformance recognizes entry-only `headers` and
`headersHelper`. It validates string maps, bounded printable helper text, archive
source restrictions, explicit `strict: false` for an active helper, digest presence
under strict validation, and restricted routing/identity header names. The pinned
2.1.269 static evidence distinguishes schema predicates, errors and strict warnings;
Core reports the warnings as diagnostics. No helper runs during these checks.
Standalone plugin manifests do not gain these fields. Marketplace `binaries` uses an unknown-valued input schema followed by filtering: invalid entries disappear, member extras are stripped, and only the first 64 valid entries survive parsing. Core recognizes the field without modifying input or promising normalization fidelity. The inspected inline marketplace validator does not apply the standalone binary warning loop; standalone support and installation behavior remain separate.

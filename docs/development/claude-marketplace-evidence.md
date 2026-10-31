---
description: Maintainer ownership, qualification and drift checks for Claude marketplace offline conformance evidence.
---

# Claude Marketplace Evidence

The registry owns the nested marketplace evidence in `packages/registry/src/claude-marketplace-evidence.ts`, the rule ledger in `claude-marketplace-rules.ts`, and the shared inventories in `claude-marketplace-inventories.ts`. Core consumes the field and source inventories. Its algorithms remain in `packages/core/src/claude-format-conformance.ts`. The `marketplaces` feature links this evidence specifically to `claude-marketplace-schema`; it is not a standalone plugin-format overlay. The link is maintenance metadata on feature support, rather than additional rendering provenance, so it does not rewrite generated lock bytes.

Each rule group names its local implementation owners, exact predicate and provenance qualification. A nonempty `schema` list retains JSON pointers and values from the recorded SchemaStore source hash. Those facts establish what that third-party schema says. They do not establish behavior in an installed Claude version. An empty list means external authority remains unresolved; related local tests do not turn that gap into provider proof. The existing hosted exact-provider validation lane remains the runtime backstop.

## Maintenance

Run `bun run providers:check` or `bun run providers:diff` to fetch the selected schema sources. The marketplace evidence inspects the same fetched bytes as the schema snapshot check. It reports changed pointer values, source-hash drift, the affected schema rule IDs and the unresolved rules requiring manual review. A schema refresh cannot silently refresh this separate evidence record: a subsequent check still fails until its changed facts and qualifications are reviewed.

`providers:update` updates schema snapshots only. Review the corresponding evidence, provider documentation and relevant tests before deliberately editing the rule ledger. Retain unresolved qualifications when a precise source or version is unavailable. Never broaden the compiler contract just to match rolling documentation.

## Implementation Coverage

The focused `claude-marketplace-coverage.test.ts` suite checks a reviewed declaration manifest under Core's test fixtures. It detects changed inline conditions, new or missing declarations, import changes and changes to the declared helper boundary. Shared field validation and the hook validator, capability projection and existing hook evidence are included. The hook dependency boundary deliberately covers entire modules, including other providers; this can require review for changes that do not affect Claude.

Fingerprints are change-review tripwires, not semantic proofs or an inferred TypeScript call graph. Every local rule ID must be associated with a reviewed declaration or dependency. Before updating a fingerprint, inspect the affected predicates, their evidence and the conformance corpus. Do not refresh fingerprints merely to clear a failure. The existing provider-format tests exercise accepted and rejected marketplace forms, and deterministic/self-hosted checks verify output stability.

This record preserves current offline validation behavior. Several stricter predicates still have unresolved runtime or version provenance; they remain visible follow-up work and do not become a beta readiness gate.

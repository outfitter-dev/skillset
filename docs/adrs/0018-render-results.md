---
id: 18
slug: render-results
title: Render Results
status: accepted
created: 2026-07-20
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, 4, 5]
---

# ADR-0018: Render Results

## Context

The feature registry describes the static support envelope for a source
feature. A build needs a separate, inspectable record of what happened to a
specific source unit for a specific target under the selected config, scope,
and policy. Without that record, transformed, degraded, skipped, or unsupported
behavior can disappear behind clean-looking output.

The earlier Lowering Outcomes and Loss Ledger decision established the need
for per-build truth but its identity, field names, and principal status were
replaced during implementation. The shipped contract is Render Results.

## Decision

Skillset uses `skillset-render-result@1` records in the `renderResults`
operation field. A render result keeps source identity and target-output
identity together through `sourceUnit`, optional `sourcePath`, `featureId`,
optional provider `target`, optional `destination`, `status`, conditional
`reason` and `policy`, produced `outputs`, structured `diagnostics`, and
supporting `evidence`.

The status vocabulary is `rendered`, `target_native`, `transformed`,
`metadata_only`, `degraded`, `lossy`, `unsupported`, `externally_managed`,
`intentionally_skipped`, and `failed`. `rendered` is the principal successful
status. A registry capability claim and a per-build result are different facts:
the former says what Skillset can generally represent; the latter says what
this build actually did. Unsupported behavior must become a result or a loud
render error, never silent omission.

Heavy provenance belongs in structured operation results, generated
`skillset.lock` files, status/explain JSON, and import/adopt reports. Ordinary
generated skills, instructions, agents, manifests, hooks, MCP files, and
resources stay free of debug markers by default. Activation, installation,
trust, and provider settings remain external to compilation.

ADR-0003 exclusively owns the soft-policy semantics for `lossy` and
`unsupported` results. It does not replace this full record model. `failed`
results always block, and no policy may invent output or target capability.

Current evidence is bounded: Core status and policy tests cover the schema and
gate, deterministic projection compares clean roots, representative adapter
tests compare registry rows with results or errors, and provider-format tests
check adopted snapshots. This proves compiler reporting behavior, not exhaustive
provider runtime behavior or every external repository.

## Consequences

Renderers and consumers share one versioned truth surface. Reviewers can see
target-specific degradation and unsupported destinations without reverse
engineering generated files, while adapters remain free to emit genuinely
different native shapes. The cost is that status, policy, and evidence changes
are contract changes with a higher review bar.

This ADR does not define a public adapter API, activate output, install or trust
plugins, mutate provider configuration, execute behavioral evals, or authorize
publishing.

## References

- [Tenets](../tenets.md) - source-first and target-truth boundaries.
- [Render Results](../features/render-results.md) - current schema, statuses, provenance, and evidence.
- [ADR-0003](0003-lossy-and-unsupported-output-policy.md) - narrow lossy and unsupported policy specialization.
- `packages/core/src/render-result.ts` - schema and validation.
- `packages/core/src/render-result-collector.ts` - result derivation.
- `packages/core/src/__tests__/render-result-build.test.ts` - build and status evidence.
- `packages/core/src/__tests__/adapter-conformance.test.ts` - representative registry/result conformance.

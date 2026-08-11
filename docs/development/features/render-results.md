---
description: The render-result contract defines how maintainers record, enforce, inspect, and verify per-operation destination outcomes.
---

# Render Results

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `render-results` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Related vocabulary: [Support Vocabulary](../../reference/features/README.md#support-vocabulary)

A render result records what one operation did with one [source unit](../../glossary.md#source-unit) for a [target](../../glossary.md#target) and [destination](../../glossary.md#destination). The feature registry owns static capability; render results own operation-specific facts such as rendered, transformed, degraded, skipped, unsupported, or failed output.

## Ownership and Inputs

`packages/core/src/render-result.ts` owns schema `skillset-render-result@1`, normalization, serialization, and structural validation. `render-result-collector.ts` derives build records from the resolved [build](../../glossary.md#build) graph, generated lock items, companion files, and unsupported features. `apps/skillset/src/import.ts` creates import-specific records, while `apps/skillset/src/adopt.ts` aggregates survey, import, and build results. `render-result-policy.ts` enforces unsupported-destination policy. Build, import, adoption, status, and explain presentation consume the normalized record instead of inventing parallel outcome vocabularies.

The schema fields are:

| Field | Contract |
| --- | --- |
| `schema` | Exact `skillset-render-result@1` stamp. |
| `sourceUnit` | Required stable source selector. |
| `sourcePath` | Optional review and diagnostic path. |
| `featureId` | Required feature-registry id or event id. |
| `target` | Optional provider target for target-specific facts. |
| `destination` | Optional non-empty artifact or scope beneath the target. |
| `status` | Required render-result status. |
| `reason` | Required for `degraded`, `lossy`, `unsupported`, and `failed`. |
| `policy` | Default, scope/target exclusion, or unsupported-destination decision. |
| `outputs` | Sorted generated paths and optional output kinds. |
| `diagnostics` | Sorted structured diagnostic references. |
| `evidence` | Sorted registry evidence supporting the classification. |

Normalization produces deterministic field order and sorts outputs, diagnostics, and evidence. External-doc evidence requires a verification date.

## Render-Result Statuses

| Status | Maintainer meaning |
| --- | --- |
| `rendered` | Faithful target representation was produced. |
| `target_native` | Explicit provider-specific source passed through to its matching target. |
| `transformed` | File shape changed while authored intent was preserved. |
| `metadata_only` | Information was retained for provenance or a sidecar but is not target-enforced. |
| `degraded` | A useful but weaker fallback was produced. |
| `lossy` | The available [projection](../../glossary.md#projection) would drop required meaning. |
| `unsupported` | The destination cannot represent the feature faithfully. |
| `externally_managed` | Installation, [activation](../../glossary.md#activation), distribution, or another external owner controls the behavior. |
| `intentionally_skipped` | Scope, target configuration, or policy excluded the output. |
| `failed` | Validation or rendering could not produce safe output. |

The default unsupported-destination policy is `error`. `warn`, `skip`, and `force` can soften only `lossy` and `unsupported`; `failed` always blocks. A softened result retains the renderer's already-defined output set and provenance. It cannot synthesize output, broaden a provider capability, or relabel an unsupported projection as faithful. An enabled target that would produce no usable output still fails.

## Outputs and Consumers

Build, diff, and output checks return render results through structured operation results and persist applicable records in [generated-output](../../glossary.md#generated-output) `skillset.lock` files. Import and adoption reports attach records to render-relevant preservation or skip facts. `skillset status --json` and `skillset explain --json` expose complete records; text output summarizes the review-sensitive subset.

Ordinary provider artifacts do not receive debug sentinels or render-result payloads. Conformance uses the structured records to compare produced outcomes with feature-registry claims.

## Changing the Contract

When adding a producer, status, policy, destination, or diagnostic:

1. Change the schema and validation owner first.
2. Update the collector or operation that has enough context to produce the fact.
3. Preserve the distinction between provider target and concrete destination.
4. Add policy tests for any blocking behavior and build tests for the emitted record.
5. Update registry evidence or support claims when the result reveals a capability change.

```bash
bun run test:focused -- packages/core/src/__tests__/render-result.test.ts packages/core/src/__tests__/render-result-policy.test.ts packages/core/src/__tests__/render-result-build.test.ts
bun run conformance:adapters
bun run docs:check
```

## Diagnostics

- A missing `reason` on a review-sensitive status is a schema violation; fix the producer rather than filling it during presentation.
- A status that disagrees with feature-registry capability is a conformance issue. Inspect the renderer, provider evidence, and selected scope before changing either side.
- A softened policy that adds, removes, or fabricates output is an enforcement bug. Policy may permit an existing projection, not define one.
- A source validation or lint problem without a destination fact belongs in diagnostics, not a synthetic render result.
- A clean operation with no usable output for an enabled target is silent [drift](../../glossary.md#drift) and must fail.

## Evidence and Decisions

- [Render Results](../../adrs/0018-render-results.md) defines the active outcome model; [ADR 0017](../../adrs/0017-lowering-outcomes-and-loss-ledger.md) is superseded historical context.
- [Deterministic Projection and Adapter Conformance](../../adrs/0019-deterministic-projection-and-adapter-conformance.md) defines registry/result comparison.
- [Post-Tools Policy Boundary](../../adrs/0021-post-tools-policy-boundary.md) defines the difference between enforcement and compatibility metadata.
- `packages/core/src/{render-result,render-result-collector,render-result-policy}.ts` owns the schema, build production, and policy; `apps/skillset/src/{import,adopt}.ts` owns import production and adoption aggregation.
- `packages/core/src/__tests__/{render-result,render-result-policy,render-result-build}.test.ts` proves normalization, validation, policy, persistence, and representative status behavior.
- `apps/skillset/src/__tests__/{contract,adopt}.test.ts` proves CLI and adoption report integration.

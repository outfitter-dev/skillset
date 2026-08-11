---
description: The feature registry defines how maintainers add, validate, document evidence for, regenerate, and troubleshoot capability entries.
---

# Feature Registry

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `feature-registry` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Related vocabulary: [Support Vocabulary](../../reference/features/README.md#support-vocabulary)

The feature registry is Skillset's typed record of feature identity, static provider capability, ownership, documentation, and evidence. It is internal compiler infrastructure, not a public extension API. The generated [support matrix](../../reference/support-matrix.md), authored feature pages, diagnostics, [render results](render-results.md), and conformance checks consume the same entries.

## Ownership and Inputs

`packages/core/src/feature-registry.ts` owns feature entries and Skillset's support decisions. `@skillset/registry` owns adopted provider [destination](../../glossary.md#destination)-format snapshots, JSON Schema snapshots, manual overlays, and dated runtime evidence. Core references those facts; it must not copy their provider inventories into another registry.

Each Core entry accepts these maintainer-facing fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable feature id used by docs, diagnostics, render results, reports, and future conformance checks. |
| `title` | Reader-facing feature name. |
| `summary` | One-sentence feature description. |
| `kind` | Broad feature family such as source, metadata, workflow, plugin component, target-native, adoption, or change management. |
| `status` | Feature entry status: implemented, planned, reserved, deferred, future, or unsupported. |
| `sourceShape` | Source path, config key, frontmatter key, or generated fact shape that defines the feature. |
| `targetSupport` | Static capability records for each supported [target](../../glossary.md#target). |
| `targetSupport.<target>.provider` | References to adopted destination formats, schemas, overlays, and unsupported destination keys. |
| `runtimeSupport` | Optional runtime, distribution, or harness support records. |
| `renderOwner` | Module or workflow that owns rendering/reporting behavior. |
| `validationOwner` | Module or workflow that owns validation behavior. |
| `docs` | Authored pages that explain the feature. |
| `evidence` | Documentation, source, tests, fixtures, provider facts, or bounded assumptions supporting the claim. |

Keep entries compact. Examples, authoring guidance, and detailed caveats belong on the linked public or development feature page.

## Outputs and Consumers

Registry support is a static capability claim; a [render result](render-results.md) is a fact about one operation. For example, the registry says whether Codex can represent plugin dependencies in general, while a [build](../../glossary.md#build) result says whether one dependency was rendered, degraded, excluded by scope, or rejected under the active policy.

`docs:generate` reads registry `docs` links and `targetSupport` rows to update generated feature-support blocks and the support matrix. Core diagnostics and `skillset lookup` use feature ids and support vocabulary. Adapter conformance compares representative produced results with the declared capability rather than treating the registry itself as runtime proof.

Feature ids may appear in locks, structured diagnostics, operation reports, `status`, `explain`, and conformance fixtures. They do not belong in ordinary provider artifacts unless a target contract explicitly requires them.

## Changing the Registry

When adding or changing an entry:

1. Confirm the render and validation owners and the exact source shape.
2. Add provider evidence strong enough for each support claim. Implemented destination claims should prefer checked-in provider snapshots plus renderer tests.
3. Link the page that owns the reader or maintainer explanation.
4. Update renderer, validator, diagnostic, and conformance evidence in the same change when the support claim changes.
5. Regenerate and verify the [projections](../../glossary.md#projection).

## Provider Evidence Refresh

Provider evidence refresh is explicit and never runs during ordinary builds or checks:

```bash
bun run providers:check
bun run providers:diff
bun run providers:update
```

`providers:check` compares adopted sources with upstream. `providers:diff` reports readable changes and manual-review surfaces. `providers:update` rewrites checked-in snapshots only after review.

Run:

```bash
bun run docs:generate
bun run docs:check
bun run conformance:adapters
bun run test:focused -- packages/core/src/__tests__/feature-registry.test.ts packages/core/src/__tests__/feature-registry-check.test.ts
```

Package-facing changes under `packages/core/src/**` or `packages/registry/src/**` also follow the [package release procedure](../package-releases.md).

## Troubleshooting

- A duplicate id, unknown vocabulary value, incomplete target row, invalid evidence reference, or missing documentation link is a registry validation failure; fix the owning entry rather than weakening the checker.
- A generated support block or matrix mismatch means registry facts changed without regeneration, or authored docs point at the wrong feature. Regenerate and inspect the projection.
- A registry row that disagrees with emitted output is a conformance failure. Verify the renderer and provider evidence before changing the support classification.
- Provider [drift](../../glossary.md#drift) without a reviewed migration remains manual review; do not update a snapshot merely to make `providers:check` green.

## Evidence and Decisions

- [Feature Reference and Schema Registry](../../adrs/0005-feature-reference-and-schema-registry.md) defines the decision.
- `packages/core/src/feature-registry.ts` defines the current typed registry.
- `packages/core/src/feature-registry-check.ts` checks documentation, evidence, and coverage drift.
- `packages/registry/src/{index.ts,schema-snapshots.ts,provider-runtime-evidence.ts}` owns provider evidence.
- `packages/core/src/activation-policy.ts` derives Skillset [activation](../../glossary.md#activation) claims, stages, reasons, actions, and fallback semantics from that evidence.
- `packages/core/src/__tests__/{feature-registry,feature-registry-check}.test.ts` pins registry vocabulary, evidence, documentation links, and coverage behavior.
- [Deterministic Projection and Adapter Conformance](../../adrs/0019-deterministic-projection-and-adapter-conformance.md) defines the registry-to-output evidence loop.

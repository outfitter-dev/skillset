---
id: 3
slug: lossy-and-unsupported-output-policy
title: Lossy and Unsupported Output Policy
status: accepted
created: 2026-07-20
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1]
amends: [1]
---

# ADR-0003: Lossy and Unsupported Output Policy

## Context

[ADR-0001](0001-root-compile-policy.md) established
`compile.unsupportedDestination: error` as the safe default and reserved
`warn`, `skip`, and `force` until Skillset could make every softened result
visible through diagnostics and provenance. That reservation was correct when
ADR-0001 was accepted: continuing without an inspectable record would have
made missing provider output look synchronized.

The implementation now satisfies that gate. The workspace schema accepts all
four policy values. Core applies the policy to structured render results before
writes, reports softened results as warnings, stamps them with the selected
`unsupported:<policy>` value, and persists their provenance in operation
results and generated lock files. Build, diff, and output verification share
that enforcement path. Status and explain expose the same structured facts.

The accepted decision therefore needs a narrow amendment. ADR-0001 remains the
historical record for the original fail-loud rollout; this successor records
why the reserved policies are now supported without weakening its target-truth
boundary.

## Decision

Skillset supports `error`, `warn`, `skip`, and `force` as values of root
`compile.unsupportedDestination`, with `error` remaining the default.

The policy applies only to render results whose status is `lossy` or
`unsupported`:

| Policy | Required behavior |
| --- | --- |
| `error` | Block build, diff, and output verification before generated-output freshness can look clean. |
| `warn` | Continue with the renderer's defined output, emit a warning diagnostic, and preserve the lossy or unsupported result in structured and lock provenance. |
| `skip` | Keep the renderer's already-defined output set without adding or pruning files, emit a warning diagnostic, and record the skipped or unsupported source/destination fact. |
| `force` | Permit a lossy or unsupported projection the renderer already defined, emit a warning diagnostic, and record the explicit override without inventing output or claiming portability. |

Every softened result records the selected `unsupported:<policy>` value and
retains its source unit, feature, provider target, destination when present,
reason, evidence, and output facts. The policy gate does not rewrite the
renderer's file set: `skip` does not prune an already-emitted lossy projection,
and `force` may permit only a lossy or unsupported projection the renderer
already defined. No non-error policy can synthesize or broaden output, confer a
target capability, or make an unsupported projection portable. Provider-native
source remains the explicit path for behavior that intentionally leaves the
portable contract.

`failed` render results always block. A non-error policy also blocks when the
selected build would otherwise contain only lock files and no usable target
output. These rules prevent a soft policy from turning compiler failure or
total omission into a successful synchronization claim.

The test: a non-error build is acceptable only when useful target output
remains and the exact loss or unsupported destination is visible without
inspecting generated target files.

## Consequences

### Positive

- Repositories can use bounded migration and provider-drift escape hatches
  without losing the evidence needed to review the result.
- Build, diff, output verification, status, explain, and lock consumers share
  one policy vocabulary and one structured render-result record.
- ADR-0001 remains intact as the historical reason provenance was required
  before soft policies became runtime behavior.

### Tradeoffs

- A successful soft-policy build can still contain unsupported or lossy facts;
  callers must treat warning diagnostics and lock provenance as part of the
  result rather than equating success with full portability.
- `warn`, `skip`, and `force` intentionally have a narrow difference in
  declared intent and provenance. None authorizes Skillset to invent a target
  capability, synthesize or broaden output, or silently emit unsafe output.

### What This Does NOT Decide

This ADR does not make `force` a portability claim or an output-synthesis
mechanism, allow any policy to soften `failed` results, or permit a successful
build with no usable non-lock output.

This ADR does not define new provider capabilities, provider-native source
formats, installation, activation, trust, marketplace approval, publishing, or
user-level configuration writes. Those decisions remain owned by their
provider evidence and explicit external workflows.

This ADR does not move heavy provenance into ordinary generated skills,
instructions, manifests, hooks, or resources. Structured operation results,
locks, status, and explain remain the review surfaces.

## References

- [Tenets](../tenets.md) - fail-loud defaults, visible drift, and provider truth.
- [ADR-0000: Source-First Loadouts](0000-source-first-loadouts.md) - source and generated-output authority.
- [ADR-0001: Root Compile Policy](0001-root-compile-policy.md) - original reservation this decision narrowly amends.
- [Render Results](../features/render-results.md) - current policy vocabulary, provenance fields, and diagnostics.
- [Post-Tools Policy Boundary](drafts/20260705-post-tools-policy-boundary.md) - policy ownership and the historical implementation bar.
- [Lowering Outcomes and Loss Ledger](drafts/20260614-lowering-outcomes-and-loss-ledger.md) - historical render-result and loss-ledger design.
- [`render-result-policy.test.ts`](../../packages/core/src/__tests__/render-result-policy.test.ts) - default and non-error policy enforcement.
- [`render-result-build.test.ts`](../../packages/core/src/__tests__/render-result-build.test.ts) - warning, policy-stamp, lock-provenance, and verification integration coverage.
- SET-18 - implementation and acceptance evidence for unsupported-destination soft policies.

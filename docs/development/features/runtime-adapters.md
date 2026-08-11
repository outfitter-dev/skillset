---
description: The runtime-adapter contract defines how maintainers classify, document evidence for, test, and troubleshoot runtime consumption.
---

# Runtime Adapters

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `runtime-adapters` | `planned` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](../../reference/features/README.md#support-vocabulary)

A runtime adapter describes how a concrete agent runtime or harness consumes a Skillset [projection](../../glossary.md#projection). It is deliberately separate from `compile.targets`: [targets](../../glossary.md#target) select provider [renderers](../../glossary.md#render), while runtime records describe consumption, compatibility mechanisms, setup, and observed behavior.

The registry feature remains `planned` because Skillset has no general runtime-adapter source or configuration contract. Individual `runtimeSupport` evidence rows and the `skillset test` harness are implemented seams; neither one graduates the general feature by itself.

## Ownership and Inputs

`packages/core/src/feature-registry.ts` owns `runtimeSupport` records and their vocabulary. `apps/skillset/src/test-runtime-adapter.ts` owns executable ad hoc adapters used by `skillset test`. Provider runtime evidence and [activation](../../glossary.md#activation) inspection facts belong in `@skillset/registry`; Core derives Skillset readiness and fallback policy from those facts.

A runtime-support row can record:

- runtime id and support status;
- compatibility mechanism and required reason;
- evidence and verification dates;
- caveats and setup requirements;
- diagnostic references.

The status distinguishes native consumption, deliberate shims, weaker degraded behavior, external management, unsupported behavior, and planned work. `shimmed` means a named compatibility mechanism can work but is not enforced by the provider; it must not be relabeled `native` or confused with semantic loss.

## Target, Runtime, and Distribution Boundary

| Concept | Owner | Example |
| --- | --- | --- |
| [Build](../../glossary.md#build) target | `compile.targets` and provider adapter | Claude, Codex, or Cursor output |
| Runtime support | Feature-registry `runtimeSupport` row | Codex CLI consumes Codex output; an agent skills preface is shimmed |
| Runtime test adapter | `skillset test` adapter implementation | Isolated non-interactive prompt and retained artifacts |
| Distribution | Distribution or marketplace workflow | A repository, plugin root, marketplace, or package [destination](../../glossary.md#destination) |
| Activation | Runtime or user-controlled state | Trust, installation, enablement, or discovery |

Adding a runtime must not make `compile.targets` accept another provider. A runtime can consume an existing target projection, a distribution artifact, or an activation harness without changing the compiler's provider set.

## Outputs and Consumers

Registry runtime rows feed capability inspection, readiness reports, Workbench runtime diagnostics, and authored provider/reference explanations. `skillset test` can exercise implemented Claude, Codex, and Cursor adapters against isolated local renderings and retain inspectable artifacts under the logical `.skillset/cache/tests/ad-hoc` path.

The runtime registry currently classifies Claude Code, Codex CLI, Codex App, Cursor, and tracked future runtimes. The registry is the exhaustive owner; this page intentionally does not duplicate its full matrix.

Runtime evidence is not [generated output](../../glossary.md#generated-output). Builds remain compact and [provider-native](../../glossary.md#provider-native), and runtime installation or trust remains [externally managed](../../start/build-versus-activation.md).

## Adding or Changing an Adapter

1. Establish current provider/runtime documentation or checked-in inspection evidence.
2. Add or update the `runtimeSupport` row with an honest status, mechanism, caveat, setup, and evidence.
3. Implement an adapter only when a deterministic isolated invocation is known.
4. Add registry-vocabulary tests and adapter tests without requiring ordinary builds to contact the runtime.
5. Update the provider reference when the user-visible readiness boundary changes.

```bash
bun run test:focused -- packages/core/src/__tests__/feature-registry.test.ts packages/core/src/__tests__/runtime-readiness.test.ts apps/skillset/src/__tests__/ad-hoc-test.test.ts
bun run docs:check
```

External adoption conformance remains an opt-in slow lane:

```bash
bun run conformance:external
```

It may acquire pinned fixtures and writes XDG-backed reports under the logical `.skillset/cache/fixtures/` path. It does not belong in default checks.

## Troubleshooting

- A runtime mistakenly accepted by `compile.targets` is a boundary violation; add a runtime record or adapter instead of expanding provider configuration.
- A `shimmed` row without a concrete mechanism and caveat overstates support. Supply both or choose a weaker status.
- An adapter that depends on user-global installation, trust, or mutable runtime state must expose that setup and remain isolated from build.
- A runtime invocation mismatch belongs in the adapter and its retained run artifacts; a provider rendering mismatch belongs in the target renderer.
- A capability claim without current evidence remains planned or unsupported rather than becoming an assumption-backed implemented row.

## Evidence and Decisions

- `packages/core/src/feature-registry.ts` owns runtime-support records and statuses.
- `packages/core/src/{runtime-readiness,activation-policy}.ts` derives readiness and activation guidance.
- `apps/skillset/src/{test-runtime-adapter,ad-hoc-test}.ts` owns isolated runtime execution.
- `packages/core/src/__tests__/{feature-registry,runtime-readiness}.test.ts` and `apps/skillset/src/__tests__/ad-hoc-test.test.ts` prove registry and adapter behavior.
- [Cursor Is a First-Class Provider](../../adrs/0002-cursor-is-a-first-class-provider.md) defines why Cursor remains a target rather than a runtime-only shim.
- [Tests and Evals](../../reference/features/tests-and-evals.md) owns the public harness contract.

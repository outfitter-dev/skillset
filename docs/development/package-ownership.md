---
description: The package-ownership contract assigns compiler, CLI, schema, registry, diagnostic, transform, and runtime-helper responsibilities.
---

# Package Ownership

This page defines the package altitude for Skillset implementation changes. It applies the [design tenets](../project/tenets.md) by assigning each consequential behavior one natural owner and keeping dependencies pointed toward that owner.

## Direction

Prefer an existing package boundary over another facade. A caller that needs behavior should import the package that owns it; it should not teach an app shim or neighboring package a second version of the contract.

Package roots represent intentional APIs. Private `internal/*` imports are [workspace](../glossary.md#workspace) implementation details, not evidence that every imported symbol belongs in the public root.

## Package Altitudes

| Package | Owns | Does not own |
| --- | --- | --- |
| `apps/skillset` | The singular CLI source implementation: entrypoint, argument parsing, terminal presentation, confirmations, exit mapping, and command composition | Compiler semantics, source-graph shape, provider facts, shared schema vocabulary, reusable lint rules, or runtime helper libraries |
| `apps/cli` | Public `@skillset/cli` Bun package metadata and the canonical bundled CLI artifact | A second CLI implementation or command-specific behavior |
| `@skillset/core` | Source resolution, compiler operations, [render](../glossary.md#render) orchestration, provider adaptation decisions, operation results, diagnostics, provenance, conformance, and compiler reports | CLI-only presentation, publication policy, schema field lists, or standalone editor UX |
| `@skillset/schema` | Shared config/frontmatter structure, value contracts, structural validation, examples, and generated JSON Schema artifacts | Path resolution, [destination](../glossary.md#destination) policy, release severity, dependency-graph semantics, rendering, or CLI formatting |
| `@skillset/lint` | Lint registry, rule types, shell, and [source-unit](../glossary.md#source-unit) rule primitives | Loading a workspace graph or deciding compiler writes |
| `@skillset/registry` | Deterministic provider snapshots, schema snapshots, runtime evidence, and provider-format migrations | Skillset support decisions, feature semantics, rendering, or [activation](../glossary.md#activation) policy |
| `@skillset/transforms` | Source-text transform recognition and adaptation | Provider rendering, graph ownership, or CLI adoption flows |
| `@skillset/toolkit` | Runtime helpers used by generated hooks and compiler-owned wrappers | Source resolution or CLI orchestration |
| `@skillset/workbench` | Authoring diagnostics, parsing, Markdown analysis, compatibility views, presets, and fixtures | Public CLI command ownership or compiler render semantics |

The unscoped `skillset` app and scoped `@skillset/cli` app are public distribution packages. They project the same CLI implementation while the unscoped package transitions to the native launcher. Other scoped workspace packages remain private implementation packages; see [Package Releases](package-releases.md) and [ADR-0029](../adrs/0029-global-cli-native-distribution.md).

## Import Policy

- Import a package root when the caller needs an intentional exported operation, type, diagnostic, or helper.
- Use `@skillset/core/internal/*` only from private workspace consumers when no stable root contract exists. Do not promote a mixed internal module wholesale to remove an import path.
- Do not add an `apps/skillset/src/*` module whose purpose is only to re-export a package internal.
- Route shared structural config and frontmatter shapes through `@skillset/schema`; keep compiler-only semantic validation in Core.
- Keep CLI-only behavior in `apps/skillset` instead of moving it into Core or wrapping it in a facade.
- Keep provider evidence in `@skillset/registry` and support decisions in Core. Evidence consumption does not transfer ownership.
- Keep authoring diagnostics in Workbench while [generated-output](../glossary.md#generated-output) and write semantics remain in Core.

`bun run package-ownership:guard` rejects app-level package-internal facade files. Its allowlist is an exceptional boundary record, not a [target](../glossary.md#target) count to preserve.

## Choosing a Public Core Export

Promote a Core internal only when all of these are true:

1. The behavior has a stable operation-shaped contract rather than exposing raw graph or storage details.
2. More than one legitimate package consumer needs the same semantics.
3. The result and diagnostics can remain provider- and presentation-neutral.
4. Tests can pin the contract without importing the CLI app.
5. The promotion does not duplicate schema, registry, lint, transform, toolkit, or Workbench ownership.

A CLI import alone is not a public-API justification. Prefer a documented private internal until the consumer contract is real.

## Large Ownership Anchors

File size alone does not justify extraction. Split an anchor when a coherent responsibility can own its inputs, outputs, and tests without importing the former orchestrator.

| Anchor | Current authority | Extraction boundary |
| --- | --- | --- |
| `packages/core/src/render.ts` | Ordered plugin and skill assembly, companion copying, lock assembly, and shared output hashing | Leaf render modules must not depend on the orchestrator |
| `packages/core/src/render-support.ts` | Private render constants, text/file helpers, safe copying, and lock-root primitives | No orchestration or public root API |
| `packages/core/src/render-marketplaces.ts` | Marketplace selection, provider catalog output, lock parsing, and provenance | No plugin assembly or generic lock orchestration |
| `packages/core/src/render-plugin-manifest.ts` | Provider manifest serialization and manifest-local component predicates | Hooks may inform output presence; manifest rendering must not own hooks |
| `packages/core/src/render-rules.ts` | Instruction destination selection, preprocessing, formatting, hashing, and rule lock items | No agent, skill, or plugin orchestration |
| `packages/core/src/render-hooks.ts` | Adaptive and native hook materialization, runtime-context wrapping, normalization, and validation | No manifest or generic companion orchestration |
| `packages/core/src/resolver.ts` | Graph construction, layout and path validation, target filtering, source loading, and path-dependent semantic validation | Shared structural fields move through Schema; extraction follows discovery or validation responsibilities |
| `packages/core/src/build.ts` | Build/diff/check orchestration, destination policy, drift, write/backup behavior, scope filtering, and operation results | CLI presentation remains in the app; a write/report slice must stand alone |
| `apps/skillset/src/cli-core.ts` | Command dispatch, argument validation, terminal presentation, exit mapping, and command composition | Reusable compiler behavior moves to its package before another command consumes it |
| `packages/core/src/feature-registry.ts` | Feature vocabulary, support decisions, owner links, and evidence normalization | Provider facts remain in Registry; generated documentation consumes Core decisions |

## Troubleshooting Ownership

- A shared field list in more than one package belongs in Schema.
- Provider snapshot data used as a support decision belongs in Registry as evidence and Core as the decision; do not merge the layers.
- A CLI file importing raw graph or storage internals usually needs a Core operation, but only promote the narrow operation the command needs.
- A renderer importing the main render orchestrator has an inverted dependency; move shared leaf primitives into `render-support.ts` or another owned leaf.
- A Workbench rule that changes compiler validity is a parallel contract; move the structural rule to Schema or the semantic rule to Core.

## Verification

Run the narrow ownership checks before the aggregate suite:

```bash
rg -n "export .*@skillset/.*/internal" apps/skillset/src -g '*.ts'
bun run package-ownership:guard
bun run typecheck
bun run changeset:check
bun run check
```

Documentation-only ownership clarification does not require a package Changeset. Runtime source or package-surface changes follow the [package release contract](package-releases.md).

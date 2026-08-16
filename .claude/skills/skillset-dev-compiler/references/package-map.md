# Compiler Ownership Map

Use this map after reading `docs/development/package-ownership.md`; that document owns the current contract.

## Package Altitude

| Surface | Owns |
| --- | --- |
| `apps/skillset` | CLI routing, arguments, terminal presentation, confirmation, exit mapping, and command composition |
| `@skillset/core` | Source resolution, compiler operations, rendering, diagnostics, provenance, conformance, and structured operation results |
| `@skillset/schema` | Shared config and frontmatter shape, value contracts, structural validation, examples, and JSON Schema artifacts |
| `@skillset/registry` | Deterministic provider and schema snapshots, runtime evidence, and provider-format migrations |
| `@skillset/workbench` | Authoring diagnostics, parsing, Markdown analysis, compatibility views, presets, and fixtures |
| `@skillset/lint` | Lint registry, rule types, shell, and source-unit rules |
| `@skillset/transforms` | Source-text transform recognition and adaptation |
| `@skillset/toolkit` | Runtime helpers used by generated hooks and compiler-owned wrappers |

## Common Anchors

- `packages/core/src/resolver.ts`: source graph construction, layout and path validation, target filtering, and compiler-only source semantics.
- `packages/core/src/render.ts`: ordered plugin and skill assembly, companion copying, lock assembly, and output hashing.
- `packages/core/src/build.ts`: build/check/diff orchestration, destination policy, drift, writes, backups, and operation results.
- `apps/skillset/src/cli-core.ts`: CLI dispatch and presentation; reusable compiler behavior must move to its owning package before another command consumes it.
- `packages/core/src/feature-registry.ts`: Skillset support decisions and evidence links; provider facts remain in Registry.

## Placement Tests

- Explicit inputs plus structured results without terminal knowledge: Core.
- `argv`, prompts, stdin, stdout/stderr, colors, tables, or exit codes: CLI app.
- Shared structural config/frontmatter rule: Schema.
- Provider fact used to justify a support decision: Registry evidence consumed by Core.
- Authoring-only analysis that does not change compiler validity: Workbench.

Promote a Core internal only for a narrow, stable operation needed by more than one legitimate package consumer. Do not create app-level re-export facades to shorten private imports.

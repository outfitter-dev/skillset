# Compiler Ownership Map

Use this map after reading `docs/development/package-ownership.md`; that document owns the current contract.

## Package Altitude

| Surface | Owns |
| --- | --- |
| `apps/skillset` | The one CLI implementation (routing, arguments, terminal presentation, confirmation, exit mapping, and command composition) plus `src/launcher.ts`, the native launcher the unscoped `skillset` npm package ships |
| `apps/cli` | Public `@skillset/cli` package metadata and the bundled JS CLI artifact; no second implementation |
| `apps/native-*` | Per-platform `@skillset/native-*` packages that carry the compiled executable the launcher selects |
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
- `apps/skillset/src/cli-core.ts`: the thin CLI router. It answers `--version` and `--help` on a fast path and lazily imports each command's `*-cli.ts` module. Argument parsing lives in `cli-args.ts`, and terminal presentation in `cli-presentation.ts` and `cli-renderers.ts`. Reusable compiler behavior must move to its owning package before another command consumes it.
- `packages/core/src/feature-registry.ts`: Skillset support decisions and evidence links; provider facts remain in Registry.

## Placement Tests

- Explicit inputs plus structured results without terminal knowledge: Core.
- `argv`, prompts, stdin, stdout/stderr, colors, tables, or exit codes: CLI app.
- Shared structural config/frontmatter rule: Schema.
- Provider fact used to justify a support decision: Registry evidence consumed by Core.
- Authoring-only analysis that does not change compiler validity: Workbench.

Promote a Core internal only for a narrow, stable operation needed by more than one legitimate package consumer. Do not create app-level re-export facades to shorten private imports.

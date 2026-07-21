# Package Ownership

This document records the package altitude doctrine for Skillset consolidation.
It implements the SET-261 ownership audit and SET-262 doctrine decision. Keep it
aligned with [Tenets](tenets.md), [Schema Contracts](schema-contracts.md), and
[Package Releases](package-releases.md).

## Direction

Prefer consolidation over new surfaces. When a caller reaches across a package
boundary, route it to the package that naturally owns the behavior instead of
adding another facade.

The app package should not grow one-line re-export files for private package
internals. Those files were useful during the initial `@skillset/core`
extraction, but they now hide ownership and teach future changes to follow the
old app boundary.

## Package Altitudes

| Package | Natural owner of | Should not own |
| --- | --- | --- |
| `apps/skillset` | CLI entrypoints, argv parsing, terminal rendering, confirmations, process exit mapping, command composition, and package bin compatibility. | Compiler semantics, source graph shape, provider support facts, schema vocabulary, reusable lint rules, or runtime helper libraries. |
| `@skillset/core` | Source graph resolution, compile/check/diff/verify operations, render orchestration, provider adaptation decisions, operation results, diagnostics, provenance, deterministic/conformance checks, and compiler-owned reports. | CLI-only presentation, package publication policy, shared schema field lists already owned by `@skillset/schema`, or standalone editor/workbench UX. |
| `@skillset/schema` | Shared source/config/frontmatter structure, JSON Schema descriptors, structural validation diagnostics, examples, and generated schema artifacts. | Compiler-only semantics such as path resolution, destination policy, release severity, dependency graph checks, or CLI formatting. |
| `@skillset/lint` | Lint rule registry, rule types, shell, and source-unit rule execution primitives. | Loading the Skillset source graph or deciding build/write behavior. `@skillset/core` may orchestrate linting across a resolved graph. |
| `@skillset/registry` | Deterministic provider snapshots, schema snapshots, hook evidence, and migration registry data. | Support decisions, feature semantics, rendering, or runtime activation. Core consumes registry evidence to make those decisions. |
| `@skillset/transforms` | Source text transform recognition and adaptation. | Provider rendering, build graph ownership, or CLI adoption flows. |
| `@skillset/toolkit` | Runtime helper surfaces intended for generated hooks and compiler-owned wrappers. | Compiler source resolution or CLI command orchestration. |
| `@skillset/workbench` | Authoring diagnostics, parser/markdown analysis, editor-oriented compatibility checks, presets, and fixtures. | CLI command ownership or compiler render semantics. |

## Import Policy

- Prefer the package root when the caller needs an intentional package API such
  as `@skillset/core`, `@skillset/schema`, `@skillset/lint`, or
  `@skillset/toolkit/runtime`.
- Use `@skillset/core/internal/*` only for private workspace consumers when the
  surface is not stable enough to expose at the package root. Record the reason
  in the owning issue when keeping such an import.
- Do not add new `apps/skillset/src/*` files whose whole purpose is
  `export * from "@skillset/core/internal/*"`.
- Do not promote a core internal just because a CLI file imports it. Promote it
  only when it is a stable operation, diagnostic, type, or helper that external
  package consumers should reasonably import.
- If the imported shape is structural source/config/frontmatter data, route the
  shared shape through `@skillset/schema` before teaching another package about
  it.
- If behavior is CLI-only, keep it in `apps/skillset` as an app module instead
  of moving it to core or wrapping it in a shim.

## Retired Shim Audit

Before SET-263/SET-264, `apps/skillset/src/` carried these one-line
compatibility facades over `@skillset/core/internal/*`. They have been retired:
app consumers now import an intentional `@skillset/core` root API when one
already exists, or a private `@skillset/core/internal/*` module directly when
the caller is still a workspace-private CLI implementation detail.

| Shim | App consumers | Disposition |
| --- | ---: | --- |
| `authoring.ts` | 2 | Removed. Consumers use `@skillset/core/internal/authoring` because these helpers remain private workspace authoring diagnostics, not a broad package contract. |
| `build.ts` | 5 | Removed. Consumers use the existing `@skillset/core` operation exports for build/diff/verify. |
| `change-ledger.ts` | 2 | Removed. Consumers use `@skillset/core/internal/change-ledger` until change/release ownership has a stable public API. |
| `changelog.ts` | 0 | Removed with no consumers. |
| `config.ts` | 8 | Removed. Parser/config helpers stay private core internals unless schema-backed structural shape moves through `@skillset/schema`. |
| `dependencies.ts` | 0 | Removed with no consumers. |
| `hooks.ts` | 0 | Removed with no consumers. |
| `lint.ts` | 4 | Removed. Consumers use the existing `@skillset/core` orchestration export for graph linting. |
| `path.ts` | 10 | Removed. Consumers use `@skillset/core/internal/path`; no wholesale stable path API was introduced. |
| `plugin-output.ts` | 2 | Removed. Output-path calculation remains private core implementation. |
| `preprocess.ts` | 1 | Removed. Preprocess helpers remain private to core/change flows. |
| `release-state.ts` | 3 | Removed. Consumers use `@skillset/core/internal/release-state` until release/change state has a stable package contract. |
| `render.ts` | 0 | Removed with no consumers. |
| `resolver.ts` | 11 | Removed. Consumers use `@skillset/core/internal/resolver`; only stable graph operations should be promoted later. |
| `resources.ts` | 0 | Removed with no consumers. |
| `skill-policy.ts` | 0 | Removed with no consumers. |
| `source-unit-selector.ts` | 8 | Removed. Selectors remain core internals tied to source/change ownership. |
| `structured-output.ts` | 6 | Removed. Serialization helpers remain private unless an external structured-output API appears. |
| `supports.ts` | 0 | Removed with no consumers. |
| `types.ts` | 17 | Removed. Stable public types use root exports; private graph/source types stay internal. |
| `versioning.ts` | 3 | Removed. Version derivation remains private core behavior. |
| `workspace-state.ts` | 5 | Removed. Consumers use existing `@skillset/core` workspace change exports. |
| `yaml.ts` | 7 | Removed. Markdown/YAML parsing remains private core implementation unless schema owns the shape. |

`bun run package-ownership:guard` now scans app source files and fails if a new
app-level package-internal facade appears.

## Core Internal Import Re-baseline (2026-07-21)

SET-342 re-baselines direct `@skillset/core/internal/*` imports after the Core
test-evaluation and source-readiness ownership moves. The inventory covers
committed production TypeScript under `apps/skillset/src`, excludes `__tests__`
directories and colocated `*.test.ts` files, and counts one TypeScript AST import
declaration regardless of line count or imported binding count. Run it against a
committed ref without checking out that ref:

```bash
bun scripts/core-internal-import-inventory.ts --ref 46e59ddda
bun scripts/core-internal-import-inventory.ts --ref "$(git log --format=%H --grep='^refactor(core): extract source readiness operation' -1)"
```

The counts are dated evidence, not a threshold enforced against future changes:

| Ref | Importing files | Import declarations | Distinct subpaths |
| --- | ---: | ---: | ---: |
| `origin/main` at `46e59ddda` | 62 | 147 | 17 |
| SET-334 reachable commit | 62 | 145 | 16 |

SET-334 replaced CI's raw `output-safety` import and one `resolver` import with
the root `checkSkillsetSourceReadiness` operation. That stable, policy-neutral
operation and result contract is the one justified public promotion from this
re-baseline. The remaining SET-334-base imports are classified below; counts are
shown as import declarations and distinct importing files.

| Internal subpath | Declarations / files | Owner and consumer need | Disposition |
| --- | ---: | --- | --- |
| `adaptive-hook-authoring` | 2 / 2 | Core owns hook authoring mechanics used by the app's new-hook flows. | The required operations already have intentional root exports; this count does not justify another API. |
| `authoring` | 5 / 5 | Core owns authoring analysis; app inspection, reconciliation, provider maintenance, CI, and recovery consume a mix of operations and private suggestion details. | Keep the private suggestion shapes internal; do not promote the module wholesale. |
| `change-ledger` | 4 / 4 | App change commands consume Core's workspace-private ledger records. | Keep internal until change and release storage has a stable library operation. |
| `config` | 11 / 10 | Setup, import, adoption, change, and try flows consume raw config readers, validators, and target helpers. | Canonical target helpers already have root exports; raw config parsing stays private or moves through `@skillset/schema` by contract. |
| `path` | 15 / 15 | App authoring and recovery flows consume compiler path ordering, containment, and slug safety. | Keep private; no broad path utility API is warranted. |
| `plugin-output` | 1 / 1 | The retained try workflow needs the compiler's private plugin destination calculation. | Keep internal as output-layout implementation detail. |
| `preprocess` | 1 / 1 | Change status inspects compiler preprocessing dependencies. | Keep internal until exposed through a stable change-status operation. |
| `release-state` | 3 / 3 | Adoption, change status, and release flows read or write workspace release state. | Keep internal while storage and workflow policy remain coupled. |
| `resolver` | 10 / 10 | Adoption, change, development, import, new-source, release, and try flows still consume raw graph loading or source discovery. | Promote only future operation-shaped contracts with named library consumers; do not expose the raw resolver. |
| `source-unit-selector` | 14 / 14 | Change, release, setup, import, and source commands share private source-unit identities. | Keep internal while selector identity remains tied to workspace workflows. |
| `structured-output` | 3 / 3 | Retained runs, tests, and try use validated serialization inside app presentation adapters. | Keep internal; CLI serialization use alone is not a public Core contract. |
| `targets` | 2 / 2 | New-hook interactive flows enumerate canonical targets. | `targetNames` is already a root API; these import sites do not require a new export. |
| `test-evaluation` | 2 / 2 | SET-333's test runner and retained-runtime adapter consume the private Core evaluation seam. | Keep internal; process, retention, reporting, and CLI policy remain app-owned. |
| `types` | 61 / 59 | App commands share a mixture of stable option/diagnostic types and private graph, source, and release models. | Use existing root types where appropriate on future touches; never promote this mixed module wholesale. |
| `versioning` | 2 / 2 | Adoption and release workflows consume private version derivation. | Keep internal until a stable version operation has a non-CLI consumer. |
| `yaml` | 9 / 9 | Import, setup, change, test, and Changesets flows parse or serialize workspace-owned documents. | Keep private; structural source contracts belong in `@skillset/schema`, not a general Core YAML API. |

No further root promotion is warranted. Imports whose symbols already exist at
the package root are ordinary routing hygiene, not evidence for expanding the
public surface; broad import normalization is outside this closeout.

## Large Ownership Anchors

Do not split large files only because they are large. Use ownership and
testability as the reason.

This is the SET-266 classification layer. It is not an instruction to split the
files immediately.

| Anchor | Current authority | Future extraction test |
| --- | --- | --- |
| `packages/core/src/render.ts` | Ordered render orchestration, plugin and skill assembly, generic companion copying, generated lock-file assembly, changelog/island/project-agent rendering, resource linking, and shared output hashing. | Keep provider and feature leaf ownership out of the orchestrator; leaf render modules must not import this file. |
| `packages/core/src/render-support.ts` | Private generated constants, rendered text/file helpers, safe recursive copying, and lock-root primitives shared by render owners. | No render orchestration or public root API. |
| `packages/core/src/render-marketplaces.ts` | Claude and Cursor marketplace emission, catalog and preserved-provider selection, existing marketplace lock parsing, and marketplace lock provenance. | No plugin assembly or generic lock-file orchestration. |
| `packages/core/src/render-plugin-manifest.ts` | Claude, Codex, and Cursor plugin manifest serialization and manifest-local surface predicates. | May depend on hook output detection; hooks must not depend on manifest rendering. |
| `packages/core/src/render-rules.ts` | Claude, Codex, and Cursor instruction destination selection, preprocessing, formatting, hashing, and rule lock items. | No project-agent, skill, or plugin orchestration. |
| `packages/core/src/render-hooks.ts` | Adaptive plugin/frontmatter hooks, effective definition materialization, runtime context wrapping, native hook normalization and validation, and Cursor event casing. | No plugin manifest or generic companion orchestration. |
| `packages/core/src/resolver.ts` | Source graph construction, workspace/source layout validation, target filtering, source frontmatter validation, output root policy, release-state attachment, resource loading, and dependency/support validation that depends on paths. | Extract only along responsibility lines such as target-native island discovery, plugin/skill discovery, output root validation, or dependency/support validation. Shared structural field validation should route through `@skillset/schema` first. |
| `packages/core/src/build.ts` | Build/diff/verify orchestration, destination outcome policy, generated drift diagnostics, persisted render outcome summaries, write/backup behavior, scope filtering, and operation result assembly. | Extract only when write planning, backup/restore policy, or operation result/report assembly can stand alone without hiding the build operation contract. CLI output formatting remains in `apps/skillset`. |
| `apps/skillset/src/cli-core.ts` | CLI command dispatch, argv parsing, flag validation, terminal presentation, process exit mapping, and command composition across app modules. | Continue extracting command islands when the behavior is CLI-only. Reusable compiler semantics should move to the owning package before another command imports them. |
| `packages/core/src/feature-registry.ts` | Feature/status vocabulary, provider/runtime support decisions, and evidence normalization that consumes registry snapshots. | Prefer generated docs/drift tooling around the registry before inventing runtime plugins. Provider evidence stays in `@skillset/registry`; support decisions stay in core. |

## Implementation Order

1. Replace app shim consumers with owned imports.
   - Use package-root imports when the API is already public.
   - Use direct `@skillset/core/internal/*` imports for temporary private
     workspace exceptions.
   - Promote only narrow, stable APIs when there is a real consumer contract.
2. Delete zero-consumer shim files first, then shims whose app consumers have
   moved.
3. Record any retained internal import exception in the issue closeout.
4. Add a small guardrail so future changes cannot recreate app-level package
   facades without an explicit exception.
5. Classify large core anchors separately before proposing extraction slices.

All five steps have been completed for the retired app-level core facades.

## Prompt Risks

- "Clean up re-exports" is too weak; it can produce import churn without
  settling ownership.
- "Expose this from core" is too broad; core root exports imply an intentional
  package API even while scoped packages remain private.
- "Split the large files" is too mechanical; extraction needs an ownership or
  testability reason.
- "Move everything to core" violates the existing schema, lint, registry,
  transforms, toolkit, and workbench altitudes.

## Verification

Use narrow checks first, then broaden:

```bash
rg -n "export .*@skillset/.*/internal" apps/skillset/src -g '*.ts'
rg -n "from './(authoring|build|change-ledger|changelog|config|dependencies|hooks|lint|path|plugin-output|preprocess|release-state|render|resolver|resources|skill-policy|source-unit-selector|structured-output|supports|types|versioning|workspace-state|yaml)'" apps/skillset/src -g '*.ts'
bun run typecheck
bun run changeset:check
bun run package-ownership:guard
bun run terminology:guard
bun run check
```

Docs-only ownership changes do not require a package Changeset unless they also
touch package-facing runtime source.

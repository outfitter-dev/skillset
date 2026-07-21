---
id: 4
slug: core-library-boundary
title: Core Library and CLI Boundary
status: accepted
created: 2026-06-12
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1]
---

# ADR-0004: Core Library and CLI Boundary

## Context

Skillset is currently a pre-release compiler with most implementation living under `apps/skillset`. The command line app already handles source loading, build/check/diff/explain/doctor, import/adopt helpers, change and release workflows, tests, and generated-output verification. That shape was useful while the product surface was still moving quickly, but it now makes two near-term goals harder than they should be:

- Other tools, especially Trails, need to call Skillset behavior from code without shelling out to the CLI or adopting Skillset's current terminal rendering.
- The CLI needs clearer rules around side effects, diagnostics, and structured results before larger feature-registry, lowering-outcome, and conformance work lands.

There is also an important sequencing constraint. Skillset is needed soon to create and maintain the agent setup for Trails, while Trails is separately moving toward a library projection capability that can compile plain TypeScript libraries without forcing those libraries to adopt Trails concepts. Skillset should not wait for that migration, and Skillset users should not need to learn Trails vocabulary or install Trails to use the compiler. At the same time, the boundary we introduce now should be compatible with a later implementation where parts of `@skillset/core` are generated or maintained through Trails.

## Decision

Create a plain TypeScript core package, exported as `@skillset/core`, and move compiler behavior behind that package in small, behavior-preserving slices. The root `@skillset/core` API must not require Trails packages, Trails types, Trails vocabulary, or a Trails runtime. Trails integration, if added later, belongs behind optional subpaths or internal build/projection machinery that preserves the same root consumer contract.

The keeper sentence is: `@skillset/core` returns Skillset compiler facts and plans; `apps/skillset` turns those facts into a command-line experience.

## Responsibility Boundary

| Area | Belongs in `@skillset/core` | Belongs in `apps/skillset` |
| --- | --- | --- |
| Inputs | Explicit root/config/options objects, source selectors, build scopes, mode objects | `argv`, environment-driven CLI defaults, stdin, prompts, confirmation flows |
| Source model | Repo/root/config resolution, source inventory, normalization, selectors, provenance baselines | Command aliases and help text that explain how to ask for the model |
| Operations | Build/check/diff/lint/doctor/explain/ci/import/adopt/test/change/release behavior as it is factored out of the CLI | Command routing, interactive affordances, terminal summaries, examples, copyable commands |
| Target lowering | Feature registry, target adapter schemas, lowering outcomes, loss ledgers, diagnostics, conformance helpers | Human-readable rendering of target outcomes and suggested next actions |
| Results | Deterministic data structures that tests, CI, products, and other tools can consume without terminal parsing | stdout/stderr writes, colors, tables, Markdown report files, exit-code mapping |
| Packaging | Library exports and private/internal API evolution | package binary wiring, CLI compatibility shims, published beta command behavior |

## Placement Test

If behavior can run from explicit inputs and return structured data without knowing how the user invoked the CLI, it belongs in core. If behavior depends on `argv`, prompts, stdin, stdout/stderr, terminal formatting, process exit behavior, package bin compatibility, or CLI help, it belongs in the app. If behavior mutates user-level Claude/Codex runtime config, installs trusted artifacts, publishes packages, or activates generated output, it is neither implicit core behavior nor ordinary build behavior; it needs an explicit future workflow.

## Side-Effect Rules

Core operations must be explicit about side effects. A core operation receives an input object and returns a structured result containing data, diagnostics, warnings/errors, and any planned or completed writes. Core must not call `process.exit`, write to stdout/stderr by default, assume ambient `process.cwd()` when a root is required, mutate user-level Claude/Codex runtime config, install trusted artifacts, or hide generated-output mutations behind read-only operation names. Operations that can write must expose that fact in their API shape and must support dry-run/check-style usage where the corresponding CLI command promises it.

## Package and Publish Posture

The scoped packages remain private while the API is being shaped. `@skillset/core` is the internal library boundary for compiler facts, structured results, diagnostics, and plans, but it is not yet a public npm contract. `@skillset/lint` and `@skillset/transforms` are implementation-support packages consumed by core and should not be published independently in v1. The published unscoped `skillset` package remains the user-facing compatibility contract.

This means package releases continue to version and publish only the `skillset` CLI package. The scoped workspaces may change exports, internal module layout, and pre-release API names without semver guarantees until a future issue explicitly promotes one of them to a public package. Any `./internal/*` export on a private workspace package is private-only compatibility plumbing for this repo, not a public subpath promise. If `@skillset/core` becomes public later, that issue must define the exported root API, remove or explicitly fence internal subpaths, define dist-tag strategy, prove npm scope ownership, and explain how Trails-facing integration stays optional. `@skillset/lint` and `@skillset/transforms` should remain private unless there is a concrete external consumer that cannot be served through `@skillset/core`.

## Future Trails Migration Posture

This ADR does not make Skillset a Trails project. Trails may eventually generate or maintain parts of the library, but root `@skillset/core` must remain plain TypeScript from the consumer's perspective. Any Trails-facing integration belongs in optional subpaths, adapters, or build/projection machinery that can change without forcing Skillset users to adopt Trails.

## Consequences

### Positive

This gives Skillset a stable place to put compiler contracts before the registry/outcome/conformance work expands the surface area. It also gives CI checks, product integrations, Trails, and other consumers a direct import path for pre-release dogfooding without coupling them to current CLI internals. The CLI can stay useful and hand-written now while being easier to replace or partially regenerate later.

The boundary makes side effects reviewable. Once core returns structured results, CLI rendering becomes a client of diagnostics instead of the only place diagnostics exist. That should make API tests, fixture tests, change/release checks, and future MCP or editor integrations easier to build from the same facts.

### Tradeoffs

This introduces an extra package before Skillset has many external consumers. The cost is acceptable because the current monolithic CLI shape is already making tests, reuse, and side-effect rules harder to reason about. To keep that cost bounded, early exports should stay small and focused on operations that are already implemented.

There will be a temporary split where some compiler modules still live in `apps/skillset` and are re-exported or called by the core shell. That is acceptable only as an incremental migration path. New compiler behavior should bias toward core once the shell exists, while CLI-only presentation stays in the app.

### What This Does NOT Decide

This ADR does not decide the final public API surface, the publish timeline for `@skillset/core`, the exact package manager workspace layout beyond a private package shell, the future Trails subpath shape, or the MCP server integration. It also does not require moving every existing module immediately. Small slices with tests are preferred over a large rename-heavy migration.

This ADR does not require renaming existing CLI modules immediately. Names such as `cli-core.ts` may become misleading as the package split proceeds, but module renames should happen only when they reduce confusion in a behavior-preserving slice.

## Acceptance Evidence

This decision is accepted as an incremental private-package boundary, not as a
claim that extraction is complete or that `@skillset/core` is a public API.
`docs/package-ownership.md`, `packages/core/package.json`, and
`packages/core/src/operation-result.ts` show the shipped boundary.
`scripts/package-ownership-guard.ts` and its focused tests prevent CLI-owned
package facades from returning while Core continues to expose structured facts
instead of argv, prompt, terminal, or process-exit policy.

## References

- [Tenets](../tenets.md) - source-first and target-native doctrine.
- [Feature Reference and Schema Registry](0005-feature-reference-and-schema-registry.md) - future registry-backed feature docs.
- [Fixtures, Tests, Dogfooding, and Evals](0012-fixtures-tests-dogfooding-and-evals.md) - fixture, test, and dogfood boundaries.
- [One-Action Repo Adoption](0024-one-action-repo-adoption.md) - import/adopt/setup boundary context.
- [Source Change, Release, and Dependency Provenance](0014-source-change-release-provenance.md) - structured result and lifecycle context.
- [Core library split research](../../.scratch/research/session-019ebd10-core-library-split-2026-06-12.md) - prior session synthesis for the package split.

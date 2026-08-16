---
title: Skillset Compiler Development
description: Implement or review Skillset compiler behavior, package ownership, rendering, command composition, operation results, and generated-output semantics. Use for changes under apps/skillset or packages/core, registry, lint, transforms, toolkit, or workbench that are not primarily shared schema-contract changes.
version: 0.1.0
---

# Skillset Compiler Development

## Work From The Owner

1. Read `docs/project/tenets.md`, the relevant ADRs, and `docs/development/package-ownership.md`.
2. Inspect the closest implementation, its package-root API, and focused tests before editing.
3. Place provider-neutral compiler facts and write semantics in `@skillset/core`; keep CLI parsing, presentation, prompts, and exit mapping in `apps/skillset`.
4. Keep provider evidence in `@skillset/registry`, shared source shape in `@skillset/schema`, authoring diagnostics in `@skillset/workbench`, and reusable lint or transform behavior in their owning packages.
5. Return structured diagnostics and operation facts from compiler layers. Do not hide writes, call `process.exit`, or make core behavior depend on terminal presentation.

Read [references/package-map.md](references/package-map.md) when choosing an owner, changing a large implementation anchor, or deciding whether an internal should become a package-root export.

## Implement And Verify

- Add focused tests for each behavior change and run them with `bun run test:focused -- <test-files...>`.
- Run `bun run typecheck` for TypeScript or package changes.
- Run the relevant deterministic or adapter conformance lane for rendering, destination, provider, or structured-result changes.
- If self-hosted source or generated-output promises change, run `bun run skillset:build`, inspect the generated diff, then run `bun run skillset:check` and `bun run skillset:check:outputs`.
- Add the required package Changeset and Skillset change entry when the release or source-change contracts require them.
- Run `bun run check` before handoff.

Do not publish, install generated artifacts, mutate user-level provider configuration, or turn provider-specific behavior into fake portable behavior.

---
title: Skillset Schema Development
description: Change or review Skillset workspace config, source frontmatter, shared metadata fields, structural validation, examples, and generated schema artifacts. Use whenever adding, removing, renaming, validating, or documenting a key shared by compiler and authoring surfaces.
version: 0.1.0
---

# Skillset Schema Development

## Keep One Contract Owner

1. Read `docs/project/tenets.md`, relevant ADRs, and `docs/development/schema-contracts.md`.
2. Confirm the field represents a real adaptive source meaning. Keep provider-only contracts under explicit provider blocks.
3. Change `packages/schema/src/contracts.ts` and shared value contracts before teaching compiler, Workbench, CLI, or documentation another shape.
4. Add structural diagnostics in `packages/schema/src/validate.ts`; keep path resolution, destination policy, graph semantics, and rendering behavior in Core.
5. Route all consumers through `@skillset/schema` instead of maintaining parallel allowed-key lists.

Read [references/contract-workflow.md](references/contract-workflow.md) for the artifact, validation, example, and release checklist.

## Verify The Contract

- Extend schema descriptor, validation, and maximal-example coverage.
- Run `bun run schema:generate`, inspect generated schemas and examples, then run `bun run schema:check`.
- Run focused schema and affected-consumer tests with `bun run test:focused -- <test-files...>`.
- Add a package Changeset for package-facing schema changes and a Skillset change entry when the self-hosted source contract or generated-output promise changes.
- Rebuild and check self-hosted output when canonical `.skillset/` source changes.
- Run `bun run typecheck` and `bun run check` before handoff.

Do not document a field that the schema package does not own, hand-edit generated schema artifacts, or use provider spelling as a second portable key for the same meaning.

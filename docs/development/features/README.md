---
description: The feature-system index routes maintainers to internal contracts, diagnostics, adapters, and verification machinery.
---

# Feature-System Internals

These pages answer maintainer questions about compiler and Workbench machinery rather than public authoring questions. Use the linked owner before changing a vocabulary, output, diagnostic, or compatibility claim:

- [Feature registry](feature-registry.md) defines typed feature status, evidence, owners, and documentation links.
- [Render results](render-results.md) defines structured [destination](../../glossary.md#destination) outcomes and loss evidence.
- [Runtime adapters](runtime-adapters.md) separates the planned general adapter contract from implemented runtime evidence and test harnesses.
- [Workbench diagnostics package](workbench.md) explains internal parsing, diagnostics, lint integration, presets, and fixtures.
- [Hook guardrails](hook-guardrails.md) documents maintainer integration snippets and runtime context boundaries.

## Maintainer Loop

For a feature-system change:

1. Start from the page whose owner produces the fact.
2. Change the typed contract and producer before its prose or generated [projection](../../glossary.md#projection).
3. Update focused evidence and troubleshooting guidance with the behavior.
4. Regenerate contract-owned documentation, inspect the diff, and run the aggregate documentation check.

```bash
bun run docs:generate
bun run docs:check
```

Provider-capability changes also run `bun run conformance:adapters`. Runtime and Workbench changes run the focused tests named on their owning pages. Public source fields, command flags, and feature support remain owned by generated [schema](../../reference/schemas/README.md), [CLI](../../reference/cli/README.md), and [feature](../../reference/features/README.md) reference rather than being restated here.

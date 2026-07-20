# Skillset Docs

This directory holds durable documentation for the local Skillset compiler.

- [Tenets](tenets.md): the slow-moving doctrine for how Skillset makes source-first provider loadouts easier to author and safer to render.
- [Architecture Decision Records](adrs/README.md): accepted decisions for source vocabulary, target rendering, compiler promises, and authoring workflows. Draft decisions live under [adrs/drafts](adrs/drafts/README.md).
- [Five-Minute Quickstart](quickstart.md): a short first-author path from `init` to one built Claude, Codex, and Cursor skill.
- [Share-Ready Checklist](quickstart.md#share-ready-checklist): the 0.16 author handoff bar before hooks or runtime activation enter the path.
- [First Author Example](../examples/first-author/README.md): a cloneable source repo deliberately narrowed to build one skill and one rule to Claude and Codex.
- [Feature Reference](features/README.md): the support registry layer for source features, target adapters, future-only surfaces, and feature-specific provenance.
- [Layout](layout.md): the current source layout, generated output shape, shared-resource behavior, rules/instructions rendering, hooks, skill policy, and import flow.
- [Schema Contracts](schema-contracts.md): the schema-first workflow, generated artifacts, and checklist for adding source/config/frontmatter fields without drift.
- [Package Ownership](package-ownership.md): the package altitude doctrine, app-level core shim audit, and consolidation order for retiring compatibility facades.
- [Package Releases](package-releases.md): the GitHub Actions, Changesets, Bun package preflight, npm publish, and Trusted Publishing flow for the public package.
- [0.x Latest Release Plan](0x-latest-release-plan.md): the release readiness bar for promoting the public package to npm `latest` without making 1.0 promises.
- [Target Surfaces](target-surfaces.md): the evidence matrix mapping Skillset source to provider target surfaces, with support vocabulary and live-doc verification dates. Golden manifest tests pin the shapes it claims.
- [Workbench Check](features/workbench.md): the authoring diagnostics and generated-output verification split, plus package-level diagnostic scopes, presets, and fixtures.

When changing the source contract, read the tenets first, check ADRs for prior decisions, use the feature reference for support shape, use the layout reference for current behavior, and follow the schema contract checklist.

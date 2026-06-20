# Skillset Docs

This directory holds durable documentation for the local Skillset compiler.

- [Tenets](tenets.md): the slow-moving doctrine for how Skillset makes source-first Claude/Codex loadouts easier to author and safer to render.
- [Architecture Decision Records](adrs/README.md): accepted decisions for source vocabulary, target rendering, compiler promises, and authoring workflows. Draft decisions live under [adrs/drafts](adrs/drafts/README.md).
- [Feature Reference](features/README.md): the support registry layer for source features, target adapters, future-only surfaces, and feature-specific provenance.
- [Layout](layout.md): the current source layout, generated output shape, shared-resource behavior, rules/instructions rendering, hooks, skill policy, and import flow.
- [Package Releases](package-releases.md): the GitHub Actions, Changesets, Bun package preflight, npm publish, and Trusted Publishing flow for the public package.
- [Target Surfaces](target-surfaces.md): the evidence matrix mapping Skillset source to Claude/Codex target surfaces, with support vocabulary and live-doc verification dates. Golden manifest tests pin the shapes it claims.
- [Workbench Check](features/workbench.md): the authoring diagnostics and generated-output verification split, plus package-level diagnostic scopes, presets, and fixtures.

When changing the source contract, read the tenets first, check ADRs for prior decisions, use the feature reference for support shape, and use the layout reference for current behavior.

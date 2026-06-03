# Skillset Docs

This directory holds durable documentation for the local Skillset compiler.

- [Tenets](tenets.md): the slow-moving doctrine for how Skillset makes source-first Claude/Codex loadouts easier to author and safer to lower.
- [Layout](layout.md): the current source layout, generated output shape, shared-resource behavior, rules/instructions lowering, hooks, skill policy, and import flow.
- [Target Surfaces](target-surfaces.md): the evidence matrix mapping Skillset source to Claude/Codex target surfaces, with status (implemented / compat alias / metadata-only / deferred) and live-doc verification dates. Golden manifest tests pin the shapes it claims.
- [Proposals](proposals/README.md): design proposals and research for not-yet-implemented work (agent source model, changelog/versioning, global installs).

When changing the source contract, read the tenets first and use the layout reference for current behavior.

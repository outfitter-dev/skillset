---
"@skillset/cli": minor
---

Plugins can own the exact workspace-relative root of their complete Claude bundle with `claude.bundle.path` in the plugin-local `skillset.yaml`. The destination carries its own `skillset.lock` and includes the manifest, skills, hooks, agents, native files, executable companions, and explicitly selected licenses without implicit provider or plugin segments.

With default marketplace placement, a bundle at `plugin` is referenced from `.claude-plugin/marketplace.json` as `./plugin`. With workspace `claude.plugins.path: dist`, a nested bundle at `dist/trails` is referenced from `dist/.claude-plugin/marketplace.json` as `./trails`. Validation rejects destinations outside a custom marketplace root, conflicts with source or provider metadata, and overlapping plugin ownership, while allowing independently locked bundles beneath their own marketplace container.

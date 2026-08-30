---
"@skillset/cli": minor
---

Plugins can own the exact root of their Claude bundle with `claude.bundle.path` in the plugin-local `skillset.yaml`. The destination receives the complete bundle (manifest, skills, hooks, agents, islands, companions, licenses) with no implicit `plugins/<id>` or provider segment, carries its own `skillset.lock`, and is validated against traversal, root reuse, nesting, and cross-plugin collisions — while the repository marketplace stays at `.claude-plugin/marketplace.json` and references the bundle as `source: ./<path>`. This is independent of the workspace-wide `claude.plugins.path`, which continues to move the marketplace and default-shaped bundles together.

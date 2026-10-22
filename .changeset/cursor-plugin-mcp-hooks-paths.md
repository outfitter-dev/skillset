---
"@skillset/core": patch
---

Build plugin MCP and plugin hooks when Cursor is enabled. Cursor's renderings now land at `.cursor-plugin/mcp.json` and `.cursor-plugin/hooks.json`, referenced from its manifest, instead of colliding with the shared `mcp.json` and Claude/Codex `hooks/hooks.json`. The `plugin-package-path-conflict` message now names the competing writers.

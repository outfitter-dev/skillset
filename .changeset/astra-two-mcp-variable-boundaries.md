---
"@skillset/core": patch
---

Preserve longer environment-variable identifiers when importing Claude MCP configuration. Exact plugin root and data placeholders still normalize, while names such as `$CLAUDE_PLUGIN_ROOTED` and `$CLAUDE_PLUGIN_DATASET` remain unchanged in command, cwd, arguments, and environment values.

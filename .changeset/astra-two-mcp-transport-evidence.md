---
"@skillset/core": patch
---

Stop inferring Streamable HTTP from ambiguous Claude or Cursor MCP URL entries and stop treating undocumented transport aliases as equivalent. Codex URL-only servers still normalize to Streamable HTTP, and Claude's explicit `http` transport still maps to its canonical spelling. Ambiguous input now reaches the existing actionable transport validation without claiming an imported plugin or altering the original source.

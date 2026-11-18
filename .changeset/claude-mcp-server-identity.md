---
"skillset": patch
"@skillset/cli": patch
---

Reject unbound portable per-server MCP policy when rendering Claude instead of emitting rules whose native server identity or matching scope may differ. Preserve global MCP denial, explicitly authored native rules and other providers' metadata. Empty MCP maps now produce no realization entry.

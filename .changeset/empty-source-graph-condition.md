---
"@skillset/core": patch
---

An empty source graph is now a typed Core condition (`EmptySourceGraphError`), so setup, new-hook target discovery, baseline retry, and release adoption no longer depend on its message wording. The message is unchanged.

---
"skillset": patch
---

Make repository verification hermetic by isolating all XDG roots in one owned per-invocation sandbox and preventing test or Stop-hook checks from registering user workspaces.

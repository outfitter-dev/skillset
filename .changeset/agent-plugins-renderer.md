---
"skillset": patch
---

Render Agent Plugins 1.0 package manifests and neutral support files under `plugins/<plugin>/agents`, preserve standard ownership in the shared lock, report provider-only components as uncovered without leaking them into the standard package, and reject symlinked or out-of-scope license inputs before reading them.

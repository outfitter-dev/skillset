---
"skillset": patch
---

Compose project SessionStart settings for `build --isolated` from the mirror under `.skillset/cache/latest/` and its lock, so an existing live settings file no longer blocks the isolated build and repeated isolated builds keep their own preimage. Marketplace selection for an isolated build is also read from the mirror lock, so a foreign or corrupt live `skillset.lock` no longer fails it.

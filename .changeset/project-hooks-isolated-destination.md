---
"skillset": patch
---

Compose project SessionStart settings for `build --isolated` from the mirror under `.skillset/cache/latest/` and its lock, so an existing live settings file no longer blocks the isolated build and repeated isolated builds keep their own preimage.

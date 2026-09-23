---
"@skillset/core": patch
---

Route every on-disk `skillset.lock` read through one fail-closed Core boundary so corrupt, unreadable, or untrusted locks cannot be treated as absent.

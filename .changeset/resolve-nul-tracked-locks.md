---
"skillset": patch
"@skillset/cli": patch
---

`skillset resolve` now finds a tracked `skillset.lock` whose path contains a newline; it reads tracked locks NUL-delimited instead of line by line.

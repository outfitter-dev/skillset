---
"skillset": patch
---

Keep the live file mode on a settings island handed back after the project SessionStart hook is turned off. Island lock items now accept the preserved four-digit mode their output hash covers, as settings entries do, so a private (`0600`) live settings file no longer produces a lock that the next build and check reject.

---
"skillset": patch
---

Record a lock-legal file mode when a settings island is handed back after the project SessionStart hook is turned off, so a private (`0600`) live settings file no longer produces a lock that the next build and check reject. The live file keeps its mode.

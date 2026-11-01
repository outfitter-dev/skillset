---
"skillset": patch
---

Report hook spawn ENOENT as a missing executable, interpreter, or working-directory possibility rather than always claiming the command is absent. Preserve exit 127 and advisory-hook handling.

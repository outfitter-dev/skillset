---
"skillset": patch
---

Refuse repository create, write, restore, and delete operations that would traverse a symlinked parent directory, while still allowing a symlink supplied as the workspace root itself.

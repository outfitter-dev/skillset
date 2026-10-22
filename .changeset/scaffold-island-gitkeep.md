---
"skillset": patch
---

`skillset init` and `skillset create` no longer scaffold empty `_claude/` and `_codex/` provider folders, and builds ignore `.gitkeep` placeholders in provider folders, so a fresh workspace no longer emits `.claude/.gitkeep` or `.codex/.gitkeep`.

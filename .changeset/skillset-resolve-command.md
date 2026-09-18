---
"skillset": minor
---

Add `skillset resolve`, which clears generated-output conflicts during a rebase or merge. It partitions the conflicted set using the lock inventory, materializes each conflicted generated path from its conflict stage so the three-way verdict sees whole files rather than markers, regenerates what is safe, and stages only paths confirmed generated. Authored conflicts block the repair and are named for a human, because regenerating from source that still carries conflict markers would render those markers into generated output. Works inside a linked git worktree.

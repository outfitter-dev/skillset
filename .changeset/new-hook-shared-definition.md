---
"skillset": minor
---

`skillset new hook` without `--attach` now writes a shared hook definition to `.skillset/hooks/` instead of failing. It prints how to attach the hook with `hooks.auto` in a plugin, skill, or project agent, since shared hooks render only where attached.

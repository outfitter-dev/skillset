---
description: "Initialize skillset config and cache"
---

Runs `skillset index` to build the skill cache and creates `.claude/skillset/config.json`. If plugin hooks are not firing, this command can also install a fallback `UserPromptSubmit` hook entry in `.claude/settings.json` pointing at the bundled `skillset-hook.ts`.

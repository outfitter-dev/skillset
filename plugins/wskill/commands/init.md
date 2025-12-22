---
description: "Initialize wskill config and cache"
---

Runs `wskill index` to build the skill cache and creates `.claude/wskill/config.json`. If plugin hooks are not firing, this command can also install a fallback `UserPromptSubmit` hook entry in `.claude/settings.json` pointing at the bundled `wskill-hook.ts`.

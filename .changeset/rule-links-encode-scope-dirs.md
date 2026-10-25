---
"skillset": patch
"@skillset/cli": patch
---

Rebased rule links now percent-encode spaces, `#`, `?`, `%`, and unbalanced parentheses in rule folder names, so a rule under a folder like `my app/` links correctly from `.claude/rules/` and `.cursor/rules/`.

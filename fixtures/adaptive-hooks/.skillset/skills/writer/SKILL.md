---
name: writer
description: Skill-local adaptive hook recipe.
hooks:
  PreToolUse:
    - hook: skill-shell
      match: Bash
      providers:
        - claude
      status: Checking skill shell
---

# Writer

Use this skill when writing fixture docs.

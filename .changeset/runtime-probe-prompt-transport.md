---
"skillset": patch
"@skillset/cli": patch
---

Prevent Claude and Cursor prompt runs from reporting a broken pipe when the provider closes stdin early. Send their prompts only as command-line arguments and keep sending Codex prompts on stdin.

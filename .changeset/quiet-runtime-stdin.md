---
"@skillset/cli": patch
---

Prevent Claude and Cursor probes from failing when the provider exits without reading stdin. Deliver their prompts through command arguments and keep Codex prompts on stdin.

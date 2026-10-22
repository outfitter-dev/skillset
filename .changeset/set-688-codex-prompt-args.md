---
"@skillset/core": patch
---

Put the prompt-argument replacement notice in the Agent Skills baseline so skills using `{{$ARGUMENTS...}}` build when Codex shares `.agents/skills/<skill>/SKILL.md`, instead of failing with an incompatible-bytes collision.

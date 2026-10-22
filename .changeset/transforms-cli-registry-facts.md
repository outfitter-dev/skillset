---
"@skillset/core": patch
"@skillset/registry": patch
"@skillset/transforms": patch
---

Transforms and adoption read the skill directories, config directories and Codex instructions file name from the registry, which now exposes `providerSkillsDirectory`, `providerProjectConfigDirectory` and the legacy `.codex/skills` location.

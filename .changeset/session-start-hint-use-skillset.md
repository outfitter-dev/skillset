---
"skillset": patch
"@skillset/cli": patch
---

The SessionStart stale-output hint now tells agents to preview with `npx skillset build`, write with `npx skillset build --yes`, and read the `use-skillset` skill, instead of naming a `skillset-help` skill that does not exist.

---
"skillset": patch
"@skillset/cli": patch
---

Relative Markdown links in rule bodies now work in every destination. Skillset reads a rule's links as relative to the directory the rule applies to (the repository root for `RULES.md`), keeps them unchanged in that directory's `AGENTS.md`, and rebases them for `.claude/CLAUDE.md`, `.claude/rules/`, and `.cursor/rules/`.

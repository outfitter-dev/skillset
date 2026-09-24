---
"skillset": minor
---

Rename the rule CLI vocabulary (ADR-0037). `skillset new rule <name>` scaffolds `.skillset/rules/` source and `skillset lookup rule` shows rule frontmatter and compatibility facts; the retired `skillset new instruction` and `skillset lookup instruction` fail with an error naming the rewrite. `init`/`adopt` report root `AGENTS.md` and `CLAUDE.md` import candidates with kind `rules` and ids `rules:<path>`, and the report schema's logical identity pattern accepts `rules:<relative-path>` instead of `instructions:<relative-path>`.

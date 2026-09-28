---
"skillset": minor
---

Rename the rule CLI vocabulary (ADR-0039). `skillset new rule <name>` scaffolds `.skillset/rules/` source and `skillset lookup rule` shows rule frontmatter and compatibility facts; the retired `skillset new instruction` and `skillset lookup instruction` fail with an error naming the rewrite. `init`/`adopt` report root `AGENTS.md` and `CLAUDE.md` import candidates with kind `rules` and ids `rules:<path>`, and new reports write `rules:<relative-path>` identities. The `skillset.report@1` schema still accepts the legacy `instructions:<relative-path>` form, so receipts recorded before this release stay valid.

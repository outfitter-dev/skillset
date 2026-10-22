---
"skillset": minor
"@skillset/core": minor
---

Generated `AGENTS.md` files now wrap each rule in an XML section with `source` and `applies_to` attributes when the file combines rules or one rule narrows with `paths:`, replacing the `<!-- source: … -->` boundary comments, which Claude strips. A lone rule without `paths:` and the `RULES.md` front page stay bare, and `CLAUDE.md` no longer carries a source comment. Builds warn when two rules reaching one `AGENTS.md` both carry a `## Code Review Rules` section.

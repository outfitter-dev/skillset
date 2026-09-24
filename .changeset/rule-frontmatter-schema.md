---
"skillset": minor
---

Rename the rule frontmatter schema contract from `instruction-frontmatter` to `rule-frontmatter` (ADR-0037). The published schema moves from `docs/reference/schemas/0.1.0/instruction-frontmatter.schema.json` to `docs/reference/schemas/0.1.0/rule-frontmatter.schema.json`, with no alias left at the old path, and diagnostics report `schema/rule-frontmatter/*` codes. `@skillset/schema` exports `ruleFrontmatterContract`, `validateRuleFrontmatter`, and `skillsetRuleFrontmatterJsonSchema`, and Workbench source-contract checks take `kind: "rule"`.

---
"@skillset/schema": patch
---

Fix the maximal workspace and rule frontmatter examples so they pass `skillset check`: distributions use the `from`/`to` shape, the workspace example covers the missing compile, plugin output, draft, workspace, provider skill selection and defaults keys, and the rule example uses `paths` instead of provider `path` fields the renderer ignores.

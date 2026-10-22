---
"skillset": patch
---

Recognize generated-output drift that `skillset build --yes` can repair on its own. When every drifted generated file differs from its source render only in whitespace or layout (equal parsed JSON, or Markdown with the same words, structure, frontmatter, and code), `skillset check` names a formatter as the likely cause and offers `skillset build` and `skillset build --yes` instead of reconcile or provider-format migration. Generated edits whose reconciliation is blocked only by each other are now one rebuildable set rather than a "cannot be rebuilt mechanically" manual-review deadlock.

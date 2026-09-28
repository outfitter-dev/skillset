---
"skillset": patch
---

`skillset move` now rewrites the moved skill's selector in pending change entry scopes and evidence, refuses when an entry's evidence map already has a key for the new selector, tells you to run `skillset change refresh --yes` (after `skillset change migrate --yes` for frontmatter entries) whenever a pending entry or its ledger evidence named the moved skill, because moved evidence hashes turn stale under the new identity, and refuses without writing when a rewritten selector does not match the schema pattern for its field, such as a distribution `from.selector` naming a workspace skill that moves into a plugin.

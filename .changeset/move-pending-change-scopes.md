---
"skillset": patch
---

`skillset move` now rewrites the moved skill's selector in pending change entry scopes and evidence, refuses when more than one of an entry's evidence keys would name the new selector, tells you to run `skillset change refresh --yes` (after `skillset change migrate --yes` for frontmatter entries) because moved evidence hashes turn stale under the new identity, and refuses without writing when a rewritten selector does not match the schema pattern for its field, such as a distribution `from.selector` naming a workspace skill that moves into a plugin.

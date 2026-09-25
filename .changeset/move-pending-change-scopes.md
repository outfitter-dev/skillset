---
"skillset": patch
---

`skillset move` now rewrites the moved skill's selector in pending change entry scopes, and refuses without writing when a rewritten selector does not match the schema pattern for its field, such as a distribution `from.selector` naming a workspace skill that moves into a plugin.

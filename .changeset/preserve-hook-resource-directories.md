---
"skillset": patch
"@skillset/cli": patch
---

Preserve custom Claude hook resource directories and opaque Markdown companions during import. Reject automatic relocation of plugin roots and managed component trees.

Plugin provider blocks now accept an explicit `opaque` directory list for byte-for-byte native resource copies. Existing authored Markdown behavior is unchanged unless opted in; missing or invalid copy directories fail validation.

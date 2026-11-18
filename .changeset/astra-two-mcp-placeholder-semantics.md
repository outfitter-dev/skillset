---
"@skillset/core": patch
---

Preserve unbraced Claude MCP variables instead of changing literal process arguments into expanding portable placeholders. Reject Claude cwd fields rather than inferring portable intent from an unsupported native field. Ambiguous imports fail without modifying the source or claiming a partially imported plugin; documented braced argument and environment placeholders remain supported.

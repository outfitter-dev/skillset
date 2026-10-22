---
"@skillset/registry": patch
---

Read provider targets from the schema `TARGET_NAMES` instead of local copies, and generate the schema snapshot target list from it so provider maintenance cannot write back a stale list.

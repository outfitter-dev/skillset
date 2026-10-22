---
"@skillset/core": patch
---

Core's applied change-history reader is now the only parser for `history.jsonl` and `amendments.jsonl`; the CLI reads through it instead of keeping a duplicate. No output changes.

---
"skillset": patch
---

Add an owned JSONL append primitive whose rollback removes only the records the writer appended, so a later concurrent append survives a failed change-ledger mutation.

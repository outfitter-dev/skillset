---
"skillset": patch
---

Serialize `change add`, `reason`, `migrate`, `refresh`, `ignore`, and `amend` on one owner-fenced change-ledger mutation, and roll back only the JSONL records each command appended so a concurrent writer's append survives a failure.

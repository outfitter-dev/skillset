---
"skillset": patch
---

Run `release apply` inside the change-ledger mutation so a failed release rolls back only its own history, release, and ledger records instead of restoring whole-file snapshots over a concurrent writer's append.

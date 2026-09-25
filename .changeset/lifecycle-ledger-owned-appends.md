---
"skillset": patch
---

Append `draft`, `promote`, and `move` lifecycle events to the change ledger instead of replacing it: the record is built from the ledger read when the transaction applies, a failed transaction removes only its own line, and the applying commands serialize with other ledger writers on the change-ledger lock.

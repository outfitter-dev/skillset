---
"skillset": patch
---

Recover release state from the ledger only for detected cache corruption. Preserve cache-read failures and unexpected internal errors instead of silently discarding them when ledger-derived state is available.

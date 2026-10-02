---
"skillset": patch
---

Prevent a freshly scaffolded draft from borrowing an abandoned fork baseline. Confirmed `new skill --draft` atomically records `source.draft-discarded` with the new files, preserving edited and moved draft provenance and append-only fork history. Older Skillset readers must be upgraded before reading this new ledger event.

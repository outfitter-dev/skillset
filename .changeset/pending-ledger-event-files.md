---
"@skillset/cli": minor
---

Change commands no longer append to `.skillset/changes/ledger.jsonl`. `change add`, `reason`, `refresh`, `ignore`, `migrate`, and the applying `draft`, `promote`, `move`, and `new` writes each record their ledger events in one new pending file, `.skillset/changes/events/<YYYYMMDDTHHMMSSmmmZ>-<event-id>.jsonl`, so branches that record changes add different files and merge without conflicts (ADR-0045). Readers fold `ledger.jsonl`, then pending files by name. `skillset release apply` folds pending files into `ledger.jsonl` and removes them. Existing ledgers need no migration.

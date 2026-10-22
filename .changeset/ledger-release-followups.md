---
"skillset": patch
"@skillset/cli": patch
---

Change-ledger and release fixes:

- `draft`, `promote`, and `move --yes` now mint a fresh ledger event id per run, so two branches running the same command from the same trunk ledger no longer produce a duplicate id that breaks every ledger read after a merge.
- `bun run change-stream:guard` accept a second amendment of the same change or release, and compare trunk's prefix correctly in CRLF checkouts.
- A failed `release apply` restores pending change files with their original permissions, and rolling back ledger appends keeps unrelated blank lines.
- Release baseline seeding (`skillset setup`, `skillset import`) writes `state.json` under the change-ledger lock.
- Note for `--json` consumers: since the lifecycle ledger moved to an owned append, the ledger entry in `draft`, `promote`, and `move` JSON plans reports `plan.operations[].kind: "append"` where it previously reported `"update"`.

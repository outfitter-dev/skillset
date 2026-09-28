---
"skillset": minor
---

Give human and JSON CLI modes one exit-code classifier. Shared classes are 0 success, 1 failure, and 2 usage. Codes 3 and 4 stay command-specific and explicit.

Visible exit-code changes: human-mode usage errors now exit 2 instead of 1; `--json` and `--jsonl` general failures now exit 1 instead of 3; and JSON-mode errors that were promoted to 2 only because their message looked like a usage error now exit 1.

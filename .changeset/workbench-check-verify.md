---
"skillset": patch
---

Split the public `skillset check` and `skillset verify` commands. `check` now owns source/workspace authoring correctness, while `verify` owns generated-output freshness and isolated output verification.

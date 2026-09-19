---
"skillset": minor
---

Add `skillset build --repair`, which consults filesystem reality instead of trusting the lock and classifies every managed output with a three-way verdict against the lock's recorded `outputHash` and a fresh render. It restores a deleted generated file byte-identically, reports a hand-edited one as `output-edited` and preserves it unless `--discard-edits` confirms the overwrite, and refuses a `diverged` path where the output and its source both moved. Verdicts print one per line and are available under `--json`.

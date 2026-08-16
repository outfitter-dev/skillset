---
"skillset": patch
---

Make `change check` scope validation invariant across baseline resolution. A pending entry scoped to a removed source unit previously stayed valid only while the git merge base still contained that unit, so an identical tree passed on a feature branch and then failed on trunk with `change-scope-invalid` once the merge base advanced past the removal. Scope validity now also accepts selectors recorded by machine-owned workspace evidence — `sourceUnits[].selector` in `.skillset/changes/ledger.jsonl` and release scope keys derived from `release.applied` events plus the cached release state — all of which live in the tree under audit. Selectors that no machine-owned record has ever named still fail `change-scope-invalid`.

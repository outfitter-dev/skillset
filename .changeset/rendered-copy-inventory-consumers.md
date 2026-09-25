---
"skillset": patch
---

Read project skill copies from the rendered-copy inventory in lint, output-root registration, and status:

- `skillset check` and lint now examine workspace drafts and selected plugin drafts that the build renders into project skill roots.
- Output-root registration matches project-use selections by status, so a live skill and its draft that enable different targets both register the provider skill root they write.

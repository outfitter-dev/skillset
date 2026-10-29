---
"@skillset/core": minor
"@skillset/cli": minor
---

Add semantic capability comparison through `skillset lookup capability`, with exact native aliases, source and destination references, scoped fidelity judgments, and pinned evidence. Keep missing judgments and changed registry evidence explicitly unknown instead of inferring semantics from destination support. A content-digest regression gate invalidates reviewed implementation evidence when cited source, tests, or docs change. Lookup stays local and does not activate providers.

---
"skillset": patch
---

Make completed workspace status inspections informational: show a conclusion and safe next action first, return zero for observed drift and blockers, and report readiness in `data.conclusion`. Unknown inspection failures remain nonzero. Remove global registry counts from status and show repository-local pending change-entry facts without claiming release readiness. The legacy status `data.ok` field is replaced by `data.conclusion.ready`; the public Core doctor report is unchanged.

Preserve corrupt output-lock diagnostics when source is empty and scope suggested commands to the inspected workspace with shell-safe root arguments.

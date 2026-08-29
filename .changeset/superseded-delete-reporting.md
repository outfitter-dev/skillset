---
"@skillset/cli": patch
---

Build reports no longer claim a path was deleted when an entry was recreated at that path after preimage staging. The transaction now classifies such paths as superseded — the unmanaged entry wins and stays on disk — and the report excludes them from `deletedPaths`.

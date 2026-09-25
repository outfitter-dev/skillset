---
"skillset": patch
---

Publish retained-run pointers, mutable statuses, and final reports through the shared atomic single-file writer so pollers never observe partial JSON. `latest.json` now points its report and status paths at the immutable `runs/<id>/` directory instead of the `latest/` copy, which is rewritten on every refresh.

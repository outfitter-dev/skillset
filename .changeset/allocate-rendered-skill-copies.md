---
"skillset": patch
---

Allocate project skill copy names once across workspace drafts and project-use copies:

- A workspace draft whose derived `draft-<name>` is held by a live workspace skill renders under the next free suffix and reports the conflict, instead of failing with an output collision. Any two copies that still claim one project skill directory fail the render loudly.

---
"skillset": patch
---

Allocate project skill copy names once across workspace drafts and project-use copies:

- A workspace draft whose derived `draft-<name>` is held by a live workspace skill renders under the next free suffix and reports the conflict, instead of failing with an output collision. Any two copies that still claim one project skill directory fail the render loudly.
- Derived copy names (`draft-` prefixes, plugin-prefixed collision renames, and numeric suffixes) stay within the Agent Skills 64-character name limit, so long skill ids no longer fail Codex classification.

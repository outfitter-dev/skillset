---
"@skillset/core": patch
"@skillset/schema": patch
---

Reject non-false `allowed_tools.cursor` in build and lint with a `cursor-allowed-tools-unsupported` diagnostic, mirroring the existing Codex fail-loud behavior; Cursor has no skill-local allowed-tools surface, so the value was previously accepted and silently ignored. Update the adaptive skill-frontmatter example to show the required Cursor opt-out.

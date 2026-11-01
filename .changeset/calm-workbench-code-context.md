---
"skillset": patch
---

Use shared Markdown code boundaries for Workbench template-placeholder diagnostics, avoiding false warnings inside nested fences and multiline code spans while preserving source positions.

Reject backticks in backtick-fence info strings so active content is not incorrectly hidden as code.

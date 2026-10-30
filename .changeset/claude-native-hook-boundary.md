---
"@skillset/cli": patch
"skillset": patch
---

Keep eligible Claude-native plugin hooks inside their provider source island while preserving emitted hook and script paths. Prevent Cursor fallback discovery from loading another provider's native hook file, and report scoping evidence without claiming arbitrary command portability.

Honor the existing plugin preprocessing opt-out for structured native files, including baseline inventory and provenance hashes, so imported runtime literals remain unchanged. Provider ownership checks inspect all copied native manifests independently of diagnostic selection.

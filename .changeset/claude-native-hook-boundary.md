---
"@skillset/cli": patch
"skillset": patch
---

Keep eligible Claude-native plugin hooks inside their provider source island while preserving emitted hook and script paths. Prevent Cursor fallback discovery from loading another provider's native hook file, and report scoping evidence without claiming arbitrary command portability.

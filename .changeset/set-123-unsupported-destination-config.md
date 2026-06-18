---
"skillset": patch
---

Cut the unsupported-render compile policy key from `compile.unsupported` to `compile.unsupportedDestination` with no legacy alias. Policy diagnostics now read "unsupported destination policy blocked …" and reference the new key.

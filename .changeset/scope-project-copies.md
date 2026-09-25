---
"skillset": patch
---

Scope project skill copies to their own source and route their diagnostics:

- Workspace draft copies no longer inherit a same-id live sibling's adaptive hooks.
- Project-use component diagnostics are gated on the scope that writes the copy, so `build --scope repo` reports (and by default blocks) omitted hooks or plugin components, and `--scope project` no longer reports copies it excludes.
- A Codex project copy that fails Agent Skills classification is omitted and reported as an unsupported result, so `compile.unsupportedDestination` decides whether the build fails instead of a raw render error.

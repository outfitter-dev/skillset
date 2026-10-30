---
"skillset": patch
"@skillset/cli": patch
---

Validate managed Claude agent skill references against effective invocation policy and reject preloads that Claude cannot load. Derive plugin skill reference namespaces from the effective emitted Claude manifest name, preserving explicit native references and other-provider behavior.

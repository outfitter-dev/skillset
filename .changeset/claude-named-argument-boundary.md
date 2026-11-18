---
"skillset": patch
"@skillset/cli": patch
---

Reject canonical named prompt-argument markers when rendering Claude output instead of emitting an unqualified `$ARGUMENTS.name` spelling. Keep whole and indexed Claude substitutions, portable markers, literal escapes and preprocessing opt-out behavior unchanged.

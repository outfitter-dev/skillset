---
"skillset": minor
---

Add configurable prompt argument placeholders for skill Markdown. `{{$ARGUMENTS}}`, `{{$ARGUMENTS[0]}}`, `{{$ARGUMENTS[1]}}`, and `{{$ARGUMENTS.name}}` now adapt to native Claude placeholders and a terse Codex instruction shim, with `compile.features.promptArguments: false` available to reject the feature. Adoption also normalizes raw Claude `$ARGUMENTS` forms to these Skillset placeholders so imported skills can build for Claude and Codex.

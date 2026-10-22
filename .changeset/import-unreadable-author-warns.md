---
"skillset": minor
"@skillset/cli": minor
---

`skillset import` and `skillset adopt` now warn instead of failing when a provider's native plugin `author` cannot become canonical source (a scalar like `42`, `{}`, an email-only object, or an empty or non-string `name`). The raw value is kept on that provider's `<provider>.manifest.author` override so it doesn't disappear, and `skillset.author` still comes only from a readable author. The `unreadable-plugin-author` adopt diagnostic is now a warning, so adoption plans and writes go through. A later build can still fail the provider's manifest conformance if the kept value is invalid there.

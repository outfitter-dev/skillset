---
"skillset": minor
"@skillset/cli": minor
---

`skillset import` and `skillset adopt` now warn instead of failing when a provider's native plugin `author` cannot become canonical source (a scalar like `42`, `{}`, an email-only object, or an empty or non-string `name`). Claude and Cursor keep the raw value on that provider's `<provider>.manifest.author` override so it doesn't disappear, and `skillset.author` still comes only from a readable author. An unreadable Codex author is omitted from `codex.manifest` and from the copied legacy `.codex-plugin/plugin.json`, because ChatGPT rendering rejects that override key for any value and a leftover legacy author conflicts with canonical metadata. Canonical author still comes from a readable author or `interface.developerName`, and the imported workspace remains buildable. The `unreadable-plugin-author` adopt diagnostic is now a warning, so adoption plans and writes go through. A later build can still fail Claude or Cursor manifest conformance if the kept value is invalid there.

---
"@skillset/core": patch
"skillset": patch
---

Stop treating retired provider-first plugin output roots as importable or conformance-relevant paths now that generated plugin output uses the plugin-first `plugins/<plugin>/<provider>` layout.

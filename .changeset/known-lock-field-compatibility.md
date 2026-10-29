---
"skillset": patch
"@skillset/cli": patch
---

Recognize valid draft, internal-use, settings ownership and legacy source-inventory fields when checking lock provenance. Source-driven rebuilds no longer misclassify untouched locks as edits or create unnecessary backups; unknown fields and invalid provenance retain recovery protection.

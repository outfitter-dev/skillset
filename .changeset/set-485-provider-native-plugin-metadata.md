---
"skillset": minor
---

Render provider-native Codex author objects and preserve supported canonical plugin metadata in Cursor manifests, with explicit omission evidence for unsupported author fields, for the canonical listing category in every accepted spelling, and for portable `skillset.manifest.category` and `skillset.manifest.tags`, which now report a lossy render result naming the `cursor.manifest` cutover. The canonical listing category dropped by a Cursor manifest is degraded only while an enabled target still renders it, and lossy — blocking under the default unsupported-destination policy — when no enabled target does, such as a Cursor-only workspace. Provider format conformance also validates `minClientVersions` members against the pinned Cursor `semver` contract instead of accepting any object.

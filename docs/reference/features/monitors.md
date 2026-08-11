---
description: Claude plugin monitors define experimental source paths, manifest wiring, validation, and provider limits.
---

# Monitors

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-monitors` | `implemented` | `pass_through` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugins can include experimental monitor definitions under `monitors/`. Skillset treats monitors as [provider-native](../../glossary.md#provider-native) Claude plugin pass-through and declares the documented experimental manifest field when the canonical monitor file exists.

## Authoring

Place monitor source under `.skillset/plugins/<plugin>/monitors/`. Discovery is automatic. The documented manifest pointer is rendered only when `monitors/monitors.json` exists.

```text
.skillset/plugins/reviewer/monitors/monitors.json
```

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `<source-root>/plugins/<plugin>/monitors/` | plugin root `monitors/` | n/a | `target_native` / `implemented` | Opaque directory pass-through for Claude. |
| `<source-root>/plugins/<plugin>/monitors/monitors.json` | manifest `experimental.monitors: "./monitors/monitors.json"` | n/a | `target_native` / `implemented` | JSON utility output is parsed after generation. |

## Diagnostics

- Refuse malformed generated JSON for known JSON files.
- Back up unmanaged [generated-output](../../glossary.md#generated-output) collisions before replacing them in confirmed builds.
- Reject divergent provider source that tries to emit the same monitor paths.
- Do not copy Claude monitors into Codex plugin output.

## Provenance

Monitor files participate in plugin output hashes and lock provenance as target-native companion files. They are not `plugin-feature` entries because v1 does not provide `monitors.source`.

## Evidence

Plugin fixtures verify experimental manifest wiring, directory copying, JSON parsing for the known manifest file, and the absence of Codex output. Other monitor files remain opaque provider source.

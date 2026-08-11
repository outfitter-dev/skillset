---
description: Claude plugin output styles define discovery, manifest wiring, pass-through behavior, and provider limits.
---

# Output Styles

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-output-styles` | `implemented` | `pass_through` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugins can include output styles under `output-styles/`. Skillset treats output styles as [provider-native](../../glossary.md#provider-native) Claude plugin pass-through and declares the documented manifest field when the directory is present.

## Authoring

Place output style files under `.skillset/plugins/<plugin>/output-styles/`. Discovery is automatic, and the directory is copied only when the Claude plugin [target](../../glossary.md#target) is active.

```text
.skillset/plugins/reviewer/output-styles/concise.md
```

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `<source-root>/plugins/<plugin>/output-styles/` | plugin root `output-styles/` plus manifest `outputStyles: "./output-styles/"` | n/a | `target_native` / `implemented` | Opaque pass-through; style semantics remain Claude-native. |

## Diagnostics

- Back up unmanaged [generated-output](../../glossary.md#generated-output) collisions before replacing them in confirmed builds.
- Reject divergent provider source that tries to emit the same generated output-style path.
- Do not copy Claude output styles into Codex plugin output.

## Provenance

Output style files participate in plugin output hashes and lock provenance as target-native companion files. They are not `plugin-feature` entries because the implemented contract does not provide `outputStyles.source` or `output-styles.source`.

## Evidence

Plugin fixtures verify manifest wiring, opaque directory copying, provider-specific output separation, and the absence of a Codex [projection](../../glossary.md#projection).

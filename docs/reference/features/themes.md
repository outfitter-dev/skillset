---
description: Claude plugin themes define experimental discovery, manifest wiring, pass-through behavior, and provider limits.
---

# Themes

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-themes` | `implemented` | `pass_through` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugins can include experimental themes under `themes/`. Skillset treats themes as [provider-native](../../glossary.md#provider-native) Claude plugin pass-through and declares the documented experimental manifest field when the directory is present.

## Authoring

Place theme files under `.skillset/plugins/<plugin>/themes/`. Discovery is automatic, and the directory is copied only when the Claude plugin [target](../../glossary.md#target) is active.

```text
.skillset/plugins/reviewer/themes/dark.json
```

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `<source-root>/plugins/<plugin>/themes/` | plugin root `themes/` plus manifest `experimental.themes: "./themes/"` | n/a | `target_native` / `implemented` | Opaque pass-through; theme semantics remain Claude-native. |

## Diagnostics

- Back up unmanaged [generated-output](../../glossary.md#generated-output) collisions before replacing them in confirmed builds.
- Reject divergent provider source that tries to emit the same generated theme path.
- Do not copy Claude themes into Codex plugin output.

## Provenance

Theme files participate in plugin output hashes and lock provenance as target-native companion files. They are not `plugin-feature` entries because v1 does not provide `themes.source`.

## Evidence

Plugin fixtures verify experimental manifest wiring, opaque directory copying, provider-specific output separation, and the absence of a Codex [projection](../../glossary.md#projection).

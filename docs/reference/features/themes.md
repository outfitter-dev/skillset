# Themes

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-themes` | `implemented` | `pass_through` | `not_applicable` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `themes`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugins can include experimental themes under `themes/`. Skillset treats themes as target-native Claude plugin pass-through and declares the documented experimental manifest field when the directory is present.

## Authoring

Place theme files under `<source-root>/plugins/<plugin>/themes/`. `<source-root>` is `.skillset/`. The directory is copied only when Claude plugin output for that plugin is active.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `<source-root>/plugins/<plugin>/themes/` | plugin root `themes/` plus manifest `experimental.themes: "./themes/"` | n/a | `target_native` / `implemented` | Opaque pass-through; theme semantics remain Claude-native. |

## Diagnostics

- Back up unmanaged generated-output collisions before replacing them in confirmed builds.
- Reject divergent provider source that tries to emit the same generated theme path.
- Do not copy Claude themes into Codex plugin output.

## Provenance

Theme files participate in plugin output hashes and lock provenance as target-native companion files. They are not `plugin-feature` entries because v1 does not provide `themes.source`.

## Tests and Fixtures

Fixtures cover experimental manifest field declaration, target-native directory copying, provider-specific output separation, and no Codex rendering.

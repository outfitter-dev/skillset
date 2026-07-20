# Output Styles

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-output-styles` | `implemented` | `pass_through` | `not_applicable` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `output-styles`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugins can include output styles under `output-styles/`. Skillset treats output styles as target-native Claude plugin pass-through and declares the documented manifest field when the directory is present.

## Authoring

Place output style files under `<source-root>/plugins/<plugin>/output-styles/`. `<source-root>` is `.skillset/`. The directory is copied only when Claude plugin output for that plugin is active.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `<source-root>/plugins/<plugin>/output-styles/` | plugin root `output-styles/` plus manifest `outputStyles: "./output-styles/"` | n/a | `target_native` / `implemented` | Opaque pass-through; style semantics remain Claude-native. |

## Diagnostics

- Back up unmanaged generated-output collisions before replacing them in confirmed builds.
- Reject divergent provider source that tries to emit the same generated output-style path.
- Do not copy Claude output styles into Codex plugin output.

## Provenance

Output style files participate in plugin output hashes and lock provenance as target-native companion files. They are not `plugin-feature` entries because v1 does not provide `outputStyles.source` or `output-styles.source`.

## Tests and Fixtures

Fixtures cover Claude manifest field declaration, target-native directory copying, provider-specific output separation, and no Codex rendering.

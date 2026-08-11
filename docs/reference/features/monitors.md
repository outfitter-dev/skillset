# Monitors

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-monitors` | `implemented` | `pass_through` | `not_applicable` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `monitors`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugins can include experimental monitor definitions under `monitors/`. Skillset treats monitors as target-native Claude plugin pass-through and declares the documented experimental manifest field when the canonical monitor file exists.

## Authoring

Place monitor source under `<source-root>/plugins/<plugin>/monitors/`. `<source-root>` is `.skillset/`. The documented manifest pointer is rendered for `monitors/monitors.json`.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `<source-root>/plugins/<plugin>/monitors/` | plugin root `monitors/` | n/a | `target_native` / `implemented` | Opaque directory pass-through for Claude. |
| `<source-root>/plugins/<plugin>/monitors/monitors.json` | manifest `experimental.monitors: "./monitors/monitors.json"` | n/a | `target_native` / `implemented` | JSON utility output is parsed after generation. |

## Diagnostics

- Refuse malformed generated JSON for known JSON files.
- Back up unmanaged generated-output collisions before replacing them in confirmed builds.
- Reject divergent provider source that tries to emit the same monitor paths.
- Do not copy Claude monitors into Codex plugin output.

## Provenance

Monitor files participate in plugin output hashes and lock provenance as target-native companion files. They are not `plugin-feature` entries because v1 does not provide `monitors.source`.

## Tests and Fixtures

Fixtures cover experimental manifest field declaration, target-native directory copying, post-generation JSON parsing for known JSON output, and no Codex rendering.

# Apps

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `future-companion-source-pointers` | `planned` | `planned` | `planned` | `planned` |
| `plugin-apps` | `implemented` | `not_applicable` | `pass_through` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `apps`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Codex plugins can include an `.app.json` app manifest. Skillset v1 treats it as target-native plugin pass-through, not as a feature-key source pointer.

## Authoring

Place `<source-root>/plugins/<plugin>/.app.json` in plugin source when an enabled Codex plugin should include the app manifest. `<source-root>` is `.skillset/`. There is no `apps.source`, `app.source`, or `apps: true` source key in v1.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `.app.json` | n/a | `.app.json` plus manifest `apps` field | `target_native` / `implemented` | Opaque pass-through today. |
| Future `apps.source` | n/a | n/a | `planned` | Reserved for a later adapter if app manifests need feature-key validation and provenance. |

## Diagnostics

- Unknown top-level plugin config keys fail, so unsupported `apps.source` syntax is not silently accepted.
- App manifest pass-through does not install, activate, trust, or mutate Codex runtime configuration.
- If provider source tries to emit a conflicting `.app.json`, divergent output detection fails loudly.

## Provenance

The current `.app.json` pass-through participates in plugin output hashes and generated manifest shape. It is not recorded as a `plugin-feature` lock entry until a future feature-key adapter owns it.

## Tests and Fixtures

Existing manifest tests cover Codex plugin interface and companion-path shape. Future app-specific tests should land with any feature-key validation or `apps.source` support.

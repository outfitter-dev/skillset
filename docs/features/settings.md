# Settings

Feature id: `settings`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugin-root `settings.json` is a documented target-native component for enabled plugins, but Skillset v1 does not copy, suggest, install, trust, or mutate settings. Settings remain future-only until a reviewed settings suggestion workflow exists.

## Authoring

There is no v1 portable settings source and no `settings.source` feature key. Authors should keep live provider settings outside generated output unless a future issue introduces an explicit review/suggestion flow.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| plugin-root `settings.json` | future reviewed suggestion or explicitly scoped native output | n/a | `target_native` / `future` | Build must not mutate live user or project settings. |
| user/project runtime settings | n/a | n/a | `future` | Setup and build commands do not write `~/.claude`, `~/.codex`, `~/.cursor`, trust settings, marketplaces, or symlinks. |

## Diagnostics

- Treat accidental live settings mutation as out of scope for `skillset build`, `check`, `diff`, `init`, and `create`.
- Keep settings suggestion output separate from generated plugin definitions until an ADR defines review, provenance, and activation boundaries.
- Do not use settings as an implicit unsupported-destination escape hatch.

## Provenance

No settings lock entry exists in v1. A future settings suggestion workflow should record source, target, rendered suggestion, review status, and whether the suggestion was applied outside build.

## Tests and Fixtures

Current tests cover setup commands refusing to mutate user-level provider config. Future settings support should add fixtures for suggestion preview, refusal to write without explicit confirmation, and provenance for reviewed changes.

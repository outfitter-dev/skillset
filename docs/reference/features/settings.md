---
description: Provider settings retain a no-write boundary and reject unsupported settings source shapes.
---

# Settings

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `future-companion-source-pointers` | `planned` | `planned` | `planned` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugin-root `settings.json` is a documented [provider-native](../../glossary.md#provider-native) component, but Skillset does not copy, suggest, install, trust, or mutate settings. The registry tracks this boundary through `future-companion-source-pointers`; it does not claim an implemented settings feature.

## Authoring

There is no portable settings source and no `settings.source` feature key. Those shapes fail config validation. Authors keep live provider settings outside [generated output](../../glossary.md#generated-output) unless a future reviewed suggestion contract explicitly owns them.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| plugin-root `settings.json` | no output | n/a | `future` | [Build](../../glossary.md#build) does not emit or mutate live user or project settings. |
| user/project runtime settings | n/a | n/a | `externally_managed` | Setup and build commands do not write provider settings, trust state, marketplaces, or symlinks. |

## Diagnostics

- Treat accidental live settings mutation as out of scope for `skillset build`, `check`, `diff`, `init`, and `create`.
- Keep settings suggestion output separate from generated plugin definitions until an ADR defines review, provenance, and [activation](../../glossary.md#activation) boundaries.
- Do not use settings as an implicit escape hatch for an unsupported [destination](../../glossary.md#destination).

## Provenance

No settings lock entry is implemented. A future settings suggestion workflow should record source, target, rendered suggestion, review status, and whether the suggestion was applied outside build.

## Evidence

Host-leak and setup tests verify that repository commands do not mutate user-level provider configuration. See [Build Versus Activation](../../start/build-versus-activation.md) and the [reviewed settings proposal](../../adrs/drafts/20260604-reviewed-settings-suggestions.md).

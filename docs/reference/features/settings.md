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

Skillset owns one narrow project-local settings entry: the SessionStart command
`npx skillset hooks run session-start`. It composes that entry into the verified
Claude `.claude/settings.local.json` and Codex `.codex/hooks.json` destinations;
it never reads or writes user-level settings. Other provider settings remain
provider-native and externally managed.

## Authoring

There is no portable settings source and no `settings.source` feature key. Those
shapes fail config validation. Set `compile.session_start_hook` to `on`, `off`,
or `auto` to control the single Skillset-owned project entry.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| project SessionStart entry | `.claude/settings.local.json` | `.codex/hooks.json` | `implemented` | Field-level ownership preserves foreign keys and array entries. |
| user runtime settings | n/a | n/a | `externally_managed` | Setup and build commands do not write user settings, trust state, marketplaces, or symlinks. |

## Diagnostics

- Treat user-level settings mutation as out of scope for `skillset build`, `check`, `diff`, `init`, and `create`.
- Keep settings suggestion output separate from generated plugin definitions until an ADR defines review, provenance, and [activation](../../glossary.md#activation) boundaries.
- Do not use settings as an implicit escape hatch for an unsupported [destination](../../glossary.md#destination).

## Provenance

The workspace lock records a `settings-entry` item with the destination file,
stable `hooks.SessionStart[*].hooks[*].command` address, and command hash. This
entry never authorizes deleting its containing settings file.

## Evidence

Host-leak and setup tests verify that repository commands do not mutate user-level provider configuration. See [Build Versus Activation](../../start/build-versus-activation.md) and the [reviewed settings proposal](../../adrs/drafts/20260604-reviewed-settings-suggestions.md).

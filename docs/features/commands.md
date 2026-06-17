# Commands

Feature id: `commands`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude plugins can include slash-command definitions under `commands/`. Skillset treats commands as target-native Claude plugin pass-through, not as portable command source and not as a Codex plugin feature.

## Authoring

Place Claude command files under `.skillset/plugins/<plugin>/commands/`. The directory is copied only when Claude plugin output for that plugin is active.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `.skillset/plugins/<plugin>/commands/` | plugin root `commands/` plus manifest `commands: "./commands"` | n/a | `target_native` / `implemented` | Opaque pass-through; command semantics remain Claude-native. |

## Diagnostics

- Back up unmanaged generated-output collisions before replacing them in confirmed builds.
- Reject divergent target-native islands that try to emit the same generated command path.
- Do not copy Claude commands into Codex plugin output.

## Provenance

Command files participate in plugin output hashes and lock provenance as target-native companion files. They are not `plugin-feature` entries because v1 does not provide a feature-key source pointer such as `commands.source`.

## Tests and Fixtures

Fixtures cover Claude plugin companion copying, manifest field declaration, provider-specific output separation, and no Codex rendering for Claude-only companion paths.

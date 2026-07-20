# Commands

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `future-companion-source-pointers` | `planned` | `planned` | `planned` | `planned` |
| `plugin-commands` | `implemented` | `pass_through` | `not_applicable` | `pass_through` |
<!-- skillset:feature-support:end -->

Feature id: `commands`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude and Cursor plugins can include command definitions under `commands/`. Skillset treats commands as target-native provider pass-through, not as portable command source; Codex has no corresponding plugin component.

## Authoring

Place command files under `<source-root>/plugins/<plugin>/commands/`. `<source-root>` is `.skillset/`. The directory is copied only when the matching Claude or Cursor plugin output for that plugin is active.

## Target Rendering

| Source | Claude output | Codex output | Cursor output | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `<source-root>/plugins/<plugin>/commands/` | plugin root `commands/` plus manifest `commands: "./commands"` | n/a | plugin root `commands/` | `target_native` / `implemented` | Opaque pass-through; command semantics remain provider-native. |

## Diagnostics

- Back up unmanaged generated-output collisions before replacing them in confirmed builds.
- Reject divergent provider source that tries to emit the same generated command path.
- Do not copy commands into Codex plugin output.

## Provenance

Command files participate in plugin output hashes and lock provenance as target-native companion files. They are not `plugin-feature` entries because v1 does not provide a feature-key source pointer such as `commands.source`.

## Tests and Fixtures

Fixtures cover Claude and Cursor plugin companion copying, provider-specific output separation, and no Codex rendering for this target-native companion path.

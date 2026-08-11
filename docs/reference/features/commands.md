---
description: Plugin commands define Claude and Cursor source paths, pass-through output, and unsupported targets.
---

# Commands

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `future-companion-source-pointers` | `planned` | `planned` | `planned` | `planned` |
| `plugin-commands` | `implemented` | `pass_through` | `not_applicable` | `pass_through` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Claude and Cursor plugins can include command definitions under `commands/`. Skillset treats commands as [provider-native](../../glossary.md#provider-native) pass-through, not as portable command source; Codex has no corresponding plugin component.

## Authoring

Place command files under `.skillset/plugins/<plugin>/commands/`. Discovery is automatic, and files are copied only when the matching Claude or Cursor plugin [target](../../glossary.md#target) is active for that plugin.

```text
.skillset/plugins/reviewer/commands/review.md
```

## Target Rendering

| Source | Claude output | Codex output | Cursor output | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `<source-root>/plugins/<plugin>/commands/` | plugin root `commands/` plus manifest `commands: "./commands"` | n/a | plugin root `commands/` | `target_native` / `implemented` | Opaque pass-through; command semantics remain provider-native. |

## Diagnostics

- Back up unmanaged [generated-output](../../glossary.md#generated-output) collisions before replacing them in confirmed builds.
- Reject divergent provider source that tries to emit the same generated command path.
- Do not copy commands into Codex plugin output.

## Provenance

Command files participate in plugin output hashes and lock provenance as target-native companion files. They are not `plugin-feature` entries because the implemented contract does not provide a feature-key source pointer such as `commands.source`.

## Evidence

Plugin rendering fixtures verify Claude and Cursor copying, provider-specific output separation, and the absence of a Codex command [projection](../../glossary.md#projection).

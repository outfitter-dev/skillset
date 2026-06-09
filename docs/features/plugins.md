# Plugins

Feature id: `plugins`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Plugins group skills and target-native companion files while preserving provider-specific bundle boundaries. Source lives under `.skillset/plugins/<plugin>/` with a plugin-local `skillset.yaml`.

## Authoring

Plugin identity derives from the directory unless `skillset.name` is present and agrees. `skillset.id` is rejected. Plugin source can configure `claude` and `codex` blocks for target opt-outs, output selection, defaults, and target-native options. Plugin-local `defaults.<target>.<surface>` is shorthand for target defaults, not provider selection.

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `.skillset/plugins/<plugin>/skillset.yaml` | `.claude-plugin/plugin.json` | `.codex-plugin/plugin.json` | `portable` / `implemented` | Manifest fields derive from source metadata and target-supported companion paths. |
| Plugin `skills/` | `skills/` | `skills/` | `portable` / `implemented` | Skill inclusion is per target and recorded in locks. |
| Claude companion paths | commands, agents, hooks, MCP, LSP, output styles, themes, monitors, assets, scripts, src, bin | n/a unless separately supported | `target_native` / `implemented` | Target truth wins over fake portability. |
| Codex companion paths | n/a unless separately supported | hooks, MCP, app manifest, assets, scripts, src | `target_native` / `implemented` | Codex plugin `agents/` and plugin `.rules` are unsupported. |

## Diagnostics

- Reject plugin identity conflicts and unsupported plugin config keys.
- Preserve plugin boundaries; do not promote plugin agents into project agents.
- Reject Codex-enabled plugin `agents/` and Codex plugin `.rules`.
- Reject divergent feature and island outputs to the same generated path.
- Refuse generated root overlaps and unsafe feature source pointers.

## Provenance

Plugin lock entries include plugin version, included and skipped skills, target state, source and output hashes, and plugin-feature entries for feature-key components such as MCP and `bin`.

## Tests and Fixtures

Fixtures cover manifest shape, companion path declarations, plugin boundary preservation, target-specific output selection, Codex plugin-agent failure, feature/source-island collisions, and generated lock provenance.

# Plugins

Feature id: `plugins`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Plugins group skills and target-native companion files while preserving provider-specific bundle boundaries. Source lives under the workspace source root's `plugins/<plugin>/` directory, such as `.skillset/plugins/<plugin>/`, with a plugin-local `skillset.yaml`.

## Authoring

Plugin identity derives from the directory unless `skillset.name` is present and agrees. `skillset.id` is rejected. Plugin source can configure `claude` and `codex` blocks for target opt-outs, output selection, defaults, and target-native options. Plugin-local `defaults.<target>.<surface>` is shorthand for target defaults, not provider selection.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `<source-root>/plugins/<plugin>/skillset.yaml` | `.claude-plugin/plugin.json` | `.codex-plugin/plugin.json` | `portable` / `implemented` | Manifest fields derive from source metadata and target-supported companion paths. |
| Plugin `skills/` | `skills/` | `skills/` | `portable` / `implemented` | Skill inclusion is per target and recorded in locks. |
| Claude companion paths | commands, agents, hooks, MCP, LSP, output styles, themes, monitors, assets, scripts, src, bin | n/a unless separately supported | `target_native` / `implemented` | Target truth wins over fake portability. |
| Codex companion paths | n/a unless separately supported | hooks, MCP, app manifest, assets, scripts, src | `target_native` / `implemented` | Codex plugin `agents/` and plugin `.rules` are unsupported. |

## Manifest Field Authority

Each generated-manifest field has exactly one writer; competing authorities are how versions drift. `skillset import` lifts all of these from a native manifest into plugin source metadata so imported plugins round-trip.

| Field | Authority | Notes |
| --- | --- | --- |
| `name` | source (`skillset.name`, defaults to directory) | `manifest.name` is the explicit override. |
| `version` | release state, with source `version` as fallback | `skillset verify` reports generated version drift; do not hand-edit generated manifests. |
| `description` | source (`summary`, falling back to `description`) | |
| `author`, `homepage`, `repository`, `license`, `keywords` | source metadata | Projected verbatim into generated manifests. |
| Component wiring (`commands`, `agents`, `skills`, `hooks`, `mcpServers`, …) | compiler | Derived from source layout and feature keys; never authored in generated output. |
| `dependencies` (Claude) | compiler, from source `dependencies` | A `claude.manifest.dependencies` override fails the build rather than competing. |

Target-native `claude.manifest` / `codex.manifest` blocks remain the visible per-target escape hatch: an override wins over the source-owned value for that target only, and stays reviewable in source.

## Diagnostics

- Reject plugin identity conflicts and unsupported plugin config keys.
- Preserve plugin boundaries; do not promote plugin agents into project agents.
- Reject Codex-enabled plugin `agents/` and Codex plugin `.rules`.
- Reject divergent feature and provider-source outputs to the same generated path.
- Refuse generated root overlaps and unsafe feature source pointers.

## Provenance

Plugin lock entries include plugin version, included and skipped skills, target state, source and output hashes, and plugin-feature entries for feature-key components such as MCP and `bin`.

## Tests and Fixtures

Fixtures cover manifest shape, companion path declarations, plugin boundary preservation, target-specific output selection, Codex plugin-agent failure, feature/provider-source collisions, and generated lock provenance.

# Plugins

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-assets` | `implemented` | `pass_through` | `pass_through` | `planned` |
| `plugin-commands` | `implemented` | `pass_through` | `not_applicable` | `pass_through` |
| `plugin-lsp-servers` | `implemented` | `pass_through` | `not_applicable` | `planned` |
| `plugin-manifests` | `implemented` | `native` | `native` | `native` |
| `plugin-monitors` | `implemented` | `pass_through` | `not_applicable` | `planned` |
| `plugin-output-styles` | `implemented` | `pass_through` | `not_applicable` | `planned` |
| `plugin-readme` | `implemented` | `pass_through` | `pass_through` | `planned` |
| `plugin-rules` | `implemented` | `not_applicable` | `not_applicable` | `pass_through` |
| `plugin-scripts` | `implemented` | `pass_through` | `pass_through` | `planned` |
| `plugin-skills` | `implemented` | `native` | `native` | `native` |
| `plugin-src` | `implemented` | `pass_through` | `pass_through` | `planned` |
| `plugin-themes` | `implemented` | `pass_through` | `not_applicable` | `planned` |
<!-- skillset:feature-support:end -->

Feature id: `plugins`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Plugins group skills and target-native companion files while preserving provider-specific bundle boundaries. Source lives under the workspace source root's `plugins/<plugin>/` directory, such as `.skillset/plugins/<plugin>/`, with a plugin-local `skillset.yaml`.

## Authoring

Plugin identity derives from the directory unless `skillset.name` is present and agrees. `skillset.id` is rejected. Plugin source can configure `claude`, `codex`, and `cursor` blocks for target opt-outs, output selection, defaults, and target-native options. Plugin-local `defaults.<target>.<surface>` is shorthand for target defaults, not provider selection.

## Target Rendering

| Source | Claude output | Codex output | Cursor output | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `<source-root>/plugins/<plugin>/skillset.yaml` | `.claude-plugin/plugin.json` | `.codex-plugin/plugin.json` | `.cursor-plugin/plugin.json` | `portable` / `implemented` | Manifest fields derive from source metadata and target-supported companion paths. |
| Plugin `skillset.license` or `LICENSE.txt` | `LICENSE.txt` | `LICENSE.txt` | `LICENSE.txt` | `portable` / `implemented` | Generated as managed plugin-bundle output and inherited by plugin skills unless overridden or opted out. |
| Plugin `skills/` | `skills/` | `skills/` | `skills/` | `portable` / `implemented` | Skill inclusion is per target and recorded in locks. |
| Claude companion paths | commands, agents, hooks, MCP, LSP, output styles, themes, monitors, assets, scripts, src, bin | n/a unless separately supported | n/a unless separately supported | `target_native` / `implemented` | Target truth wins over fake portability. |
| Codex companion paths | n/a unless separately supported | hooks, MCP, app manifest, assets, scripts, src | n/a unless separately supported | `target_native` / `implemented` | Codex plugin `agents/` and plugin `.rules` are unsupported. |
| Cursor companion paths | n/a unless separately supported | n/a unless separately supported | commands, agents, hooks, MCP, rules, and provider source | `target_native` / `implemented` | The checked support matrix remains authoritative: assets, LSP, monitors, output styles, README, scripts, src, and themes are not implied by this row. |

## Manifest Field Authority

Each generated-manifest field has exactly one writer; competing authorities are how versions drift. `skillset import` lifts portable metadata from a native manifest into canonical plugin source, re-derives component wiring from the imported layout, and keeps only residual provider-specific options in target manifest overrides.

| Field | Authority | Notes |
| --- | --- | --- |
| `name` | source (`skillset.name`, defaults to directory) | `manifest.name` is the explicit override. |
| `version` | release state, with source `version` as fallback | `skillset check --only outputs` reports generated version drift; do not hand-edit generated manifests. |
| `description` | source (`summary`, falling back to `description`) | |
| `author`, `homepage`, `repository`, `license`, `keywords` | source metadata | Projected into generated manifests. `license` also drives managed `LICENSE.txt` generation from the supported SPDX catalog or a local source file. |
| Component wiring (`commands`, `agents`, `skills`, `hooks`, `mcpServers`, …) | compiler | Derived from source layout and feature keys; never authored in generated output. |
| `dependencies` (Claude) | compiler, from source `dependencies` | A `claude.manifest.dependencies` override fails the build rather than competing. |

Target-native `claude.manifest` / `codex.manifest` / `cursor.manifest` blocks remain the visible per-target escape hatch: an override wins over the source-owned value for that target only, and stays reviewable in source.

## Diagnostics

- Reject plugin identity conflicts and unsupported plugin config keys.
- During whole-repo adoption, compare Claude, Codex, and Cursor native candidates by manifest identity plus deterministic non-manifest source evidence before writing.
- Normalize equivalent provider roots into one canonical `.skillset/plugins/<plugin>/` source while preserving provider-specific manifest options without shadowing portable metadata or compiler-owned component paths.
- Coalesce compatible sparse portable metadata into canonical source, and block conflicting portable values before choosing a primary provider manifest.
- Block same-identity divergent roots and name-only matches; keep similar different identities separate with an advisory merge warning.
- Exclude nested plugin candidates from a root plugin import so adoption never crosses plugin boundaries.
- Preserve plugin boundaries; do not promote plugin agents into project agents.
- Reject Codex-enabled plugin `agents/` and Codex plugin `.rules`.
- Reject divergent feature and provider-source outputs to the same generated path.
- Refuse generated root overlaps and unsafe feature source pointers.

## Provenance

Plugin lock entries include plugin version, included and skipped skills, target state, source and output hashes, and plugin-feature entries for feature-key components such as MCP and `bin`.

## Tests and Fixtures

Fixtures cover manifest shape, companion path declarations, plugin boundary preservation, target-specific output selection, Codex plugin-agent failure, feature/provider-source collisions, generated lock provenance, three-provider adoption permutations, equivalent and divergent candidate roots, root/nested boundaries, traversal determinism, and external-report diagnostics.

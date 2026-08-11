---
description: Explains how Skillset renders adaptive and Codex-native source into Codex provider output.
---

# Codex Provider

Provider id: `codex`

The Codex [target](../../glossary.md#target) [renders](../../glossary.md#render) project guidance and configuration under `.codex/`, directory-local `AGENTS.md` files, and plugin bundles with a native `.codex-plugin/plugin.json` interface as [generated output](../../glossary.md#generated-output). [Adaptive source](../../glossary.md#adaptive-source) remains [canonical source](../../glossary.md#canonical-source); Codex-only behavior belongs in explicit [provider-native](../../glossary.md#provider-native) source or Codex-scoped overrides.

## Provider Shape

Portable listing metadata renders to the Codex plugin `interface` fields. The Codex provider format has companion locations for hooks, MCP servers, apps, assets, scripts, and source files; format availability alone is not a Skillset implementation claim, so the generated registry table below reports current support for each feature. Codex does not currently expose a plugin-local agent or executable-bin surface equivalent to Claude's, so Skillset reports those [destinations](../../glossary.md#destination) as unsupported instead of copying incompatible files.

Adaptive project agents render as TOML under `.codex/agents/`. Adaptive instruction source renders to directory-local `AGENTS.md` files. Codex `.rules` files are command-execution policy, not prose guidance, and remain a provider-native surface rather than an alternative rendering of instructions. Tool policy that has no skill-local Codex enforcement surface remains visible metadata rather than a false [activation](../../glossary.md#activation) claim.

For exact source and destination behavior, use the feature pages for [plugins](../features/plugins.md), [agents](../features/agents.md), [instructions](../features/instructions.md), [hooks](../features/hooks.md), [apps](../features/apps.md), and [tools policy](../features/tools-policy.md).

## Feature Support

<!-- skillset:generated:start provider-feature-support -->
| Feature | Feature status | Target support | Qualification | Docs |
| --- | --- | --- | --- | --- |
| Activation Probes | `implemented` | `not_applicable` | — | [1](../features/tests-and-evals.md) |
| Adaptive Hooks | `implemented` | `degraded` | Codex supports plugin-level command hooks, but has no faithful skill-local or project-agent hook destination and narrower event/matcher support. | [1](../features/hooks.md) |
| Changes | `implemented` | `not_applicable` | — | [1](../features/changes.md) |
| Dependencies | `implemented` | `degraded` | Codex gets generated dependency notices rather than a native plugin dependency resolver. | [1](../features/dependencies.md) |
| Dev Watch | `implemented` | `not_applicable` | — | [1](../features/dev-watch.md) |
| Distributions | `implemented` | `not_applicable` | — | [1](../features/distributions.md) |
| Feature Registry | `implemented` | `not_applicable` | — | [1](../../development/features/feature-registry.md) |
| Future Companion Source Pointers | `planned` | `planned` | — | [1](../features/apps.md), [2](../features/hooks.md), [3](../features/commands.md), [4](../features/settings.md) |
| Marketplaces | `implemented` | `future` | Codex plugin bundles are renderable, but Codex marketplace activation is currently a runtime config surface rather than a provider-owned generated index. | [1](../features/marketplaces.md) |
| Output Safety | `implemented` | `not_applicable` | — | [1](../features/output-safety.md) |
| Plugin Agents | `implemented` | `unsupported` | Codex plugin documentation does not include a plugin agents component. | [1](../features/agents.md) |
| Codex Plugin Apps | `implemented` | `pass_through` | — | [1](../features/apps.md) |
| Plugin Assets | `implemented` | `pass_through` | — | [1](../features/plugins.md) |
| Plugin Bin | `implemented` | `unsupported` | Codex plugins do not expose a documented plugin-local bin contract. | [1](../features/executables.md), [2](../features/feature-source-pointers.md) |
| Plugin Commands | `implemented` | `not_applicable` | — | [1](../features/commands.md), [2](../features/plugins.md) |
| Plugin Hooks | `implemented` | `pass_through` | — | [1](../features/hooks.md) |
| Plugin LSP Servers | `implemented` | `not_applicable` | — | [1](../features/lsp-servers.md), [2](../features/plugins.md) |
| Plugin Manifests | `implemented` | `native` | — | [1](../features/plugins.md) |
| Plugin MCP Servers | `implemented` | `native` | — | [1](../features/feature-source-pointers.md), [2](../features/mcp-servers.md) |
| Plugin Monitors | `implemented` | `not_applicable` | — | [1](../features/monitors.md), [2](../features/plugins.md) |
| Plugin Output Styles | `implemented` | `not_applicable` | — | [1](../features/output-styles.md), [2](../features/plugins.md) |
| Plugin README | `implemented` | `pass_through` | — | [1](../features/plugins.md) |
| Plugin Rules | `implemented` | `not_applicable` | — | [1](../features/instructions.md), [2](../features/plugins.md) |
| Plugin Scripts | `implemented` | `pass_through` | — | [1](../features/plugins.md) |
| Plugin Skills | `implemented` | `native` | — | [1](../features/plugins.md), [2](../features/skills.md) |
| Plugin Source | `implemented` | `pass_through` | — | [1](../features/plugins.md) |
| Plugin Themes | `implemented` | `not_applicable` | — | [1](../features/themes.md), [2](../features/plugins.md) |
| Project Agents | `implemented` | `transformed` | — | [1](../features/agents.md) |
| Project Instructions | `implemented` | `transformed` | — | [1](../features/instructions.md) |
| Releases | `implemented` | `metadata_only` | — | [1](../features/releases.md) |
| Render Results | `implemented` | `not_applicable` | — | [1](../../development/features/render-results.md) |
| Resources | `implemented` | `native` | — | [1](../features/resources.md) |
| Runtime Adapters | `planned` | `not_applicable` | — | [1](../../development/features/runtime-adapters.md) |
| Runtime Context | `implemented` | `transformed` | Normalized fields are provider, hook.event, and session.id; raw Codex environment remains available to the hook command. | [1](../features/hooks.md), [2](../../development/features/hook-guardrails.md) |
| Standalone Skills | `implemented` | `native` | — | [1](../features/skills.md) |
| Supports | `implemented` | `metadata_only` | — | [1](../features/supports.md) |
| Provider Source | `implemented` | `pass_through` | — | [1](../features/target-native-islands.md) |
| Tools Policy | `implemented` | `metadata_only` | Recorded as .skillset.tools.yaml metadata; no proven skill-local enforcement surface. | [1](../features/tools-policy.md) |
| Version Audit | `implemented` | `not_applicable` | — | [1](../features/version-audit.md) |
| Workflows | `implemented` | `not_applicable` | — | [1](../features/ci.md), [2](../features/build-scopes.md), [3](../../development/features/workbench.md) |
<!-- skillset:generated:end provider-feature-support -->

## Evidence Boundary

Implemented provider claims are backed by checked-in destination-format snapshots, schema snapshots or manual overlays, and rendering tests. The generated table reports registry status; it does not make an app, plugin, or agent trusted by a Codex runtime.

Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](../../start/build-versus-activation.md).

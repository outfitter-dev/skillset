---
description: Explains how Skillset renders adaptive and Cursor-native source into Cursor provider output.
---

# Cursor Provider

Provider id: `cursor`

Cursor is a first-class Skillset [target](../../glossary.md#target), not a Claude or Codex compatibility shim. It participates in the default provider plan, and repositories can narrow output through explicit `compile.targets` configuration.

## Provider Shape

Skillset [renders](../../glossary.md#render) project skills under `.cursor/skills/`, [adaptive instructions](../features/instructions.md) as `.cursor/rules/**/*.mdc`, project agents under `.cursor/agents/`, and plugin bundles with a native `.cursor-plugin/plugin.json` manifest as [generated output](../../glossary.md#generated-output). Cursor plugin output can include rules, skills, agents, commands, hooks, and MCP configuration. Marketplace source can render a Cursor-owned `.cursor-plugin/marketplace.json` index after explicit readiness checks and update confirmation.

Cursor-native source remains available under explicit `_cursor/` paths. Skillset lifts a [provider-native](../../glossary.md#provider-native) shape into [adaptive source](../../glossary.md#adaptive-source) only when registry evidence proves a faithful mapping; otherwise the provider boundary stays visible and [canonical source](../../glossary.md#canonical-source) stays explicit.

For exact source and [destination](../../glossary.md#destination) behavior, use the feature pages for [skills](../features/skills.md), [instructions](../features/instructions.md), [agents](../features/agents.md), [plugins](../features/plugins.md), [hooks](../features/hooks.md), [MCP servers](../features/mcp-servers.md), and [marketplaces](../features/marketplaces.md).

## Feature Support

<!-- skillset:generated:start provider-feature-support -->
| Feature | Feature status | Target support | Qualification | Docs |
| --- | --- | --- | --- | --- |
| Activation Probes | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/tests-and-evals.md) |
| Adaptive Hooks | `implemented` | `degraded` | Cursor supports plugin-level command hooks, but has no faithful skill-local or project-agent hook destination and uses provider-native lower-camel event names. | [1](../features/hooks.md) |
| Changes | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/changes.md) |
| Dependencies | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/dependencies.md) |
| Dev Watch | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/dev-watch.md) |
| Distributions | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/distributions.md) |
| Feature Registry | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../../development/features/feature-registry.md) |
| Future Companion Source Pointers | `planned` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/apps.md), [2](../features/hooks.md), [3](../features/commands.md), [4](../features/settings.md) |
| Marketplaces | `implemented` | `native` | — | [1](../features/marketplaces.md) |
| Output Safety | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/output-safety.md) |
| Plugin Agents | `implemented` | `pass_through` | — | [1](../features/agents.md) |
| Codex Plugin Apps | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/apps.md) |
| Plugin Assets | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/plugins.md) |
| Plugin Bin | `implemented` | `unsupported` | Cursor plugins do not expose a documented plugin-local bin contract. | [1](../features/executables.md), [2](../features/feature-source-pointers.md) |
| Plugin Commands | `implemented` | `pass_through` | — | [1](../features/commands.md), [2](../features/plugins.md) |
| Plugin Hooks | `implemented` | `pass_through` | — | [1](../features/hooks.md) |
| Plugin LSP Servers | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/lsp-servers.md), [2](../features/plugins.md) |
| Plugin Manifests | `implemented` | `native` | — | [1](../features/plugins.md) |
| Plugin MCP Servers | `implemented` | `native` | — | [1](../features/feature-source-pointers.md), [2](../features/mcp-servers.md) |
| Plugin Monitors | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/monitors.md), [2](../features/plugins.md) |
| Plugin Output Styles | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/output-styles.md), [2](../features/plugins.md) |
| Plugin README | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/plugins.md) |
| Plugin Rules | `implemented` | `pass_through` | — | [1](../features/instructions.md), [2](../features/plugins.md) |
| Plugin Scripts | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/plugins.md) |
| Plugin Skills | `implemented` | `native` | — | [1](../features/plugins.md), [2](../features/skills.md) |
| Plugin Source | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/plugins.md) |
| Plugin Themes | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/themes.md), [2](../features/plugins.md) |
| Project Agents | `implemented` | `native` | — | [1](../features/agents.md) |
| Project Instructions | `implemented` | `transformed` | — | [1](../features/instructions.md) |
| Releases | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/releases.md) |
| Render Results | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../../development/features/render-results.md) |
| Resources | `implemented` | `native` | — | [1](../features/resources.md) |
| Runtime Adapters | `planned` | `planned` | cursor provider support is not registered for this feature yet. | [1](../../development/features/runtime-adapters.md) |
| Runtime Context | `implemented` | `transformed` | Normalized fields are provider, hook.event, and session.id; raw Cursor environment remains available to the hook command. | [1](../features/hooks.md), [2](../../development/features/hook-guardrails.md) |
| Standalone Skills | `implemented` | `native` | — | [1](../features/skills.md) |
| Supports | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/supports.md) |
| Provider Source | `implemented` | `pass_through` | — | [1](../features/target-native-islands.md) |
| Tools Policy | `implemented` | `metadata_only` | Recorded as .skillset.tools.yaml metadata; no proven skill-local enforcement surface. | [1](../features/tools-policy.md) |
| Version Audit | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/version-audit.md) |
| Workflows | `implemented` | `planned` | cursor provider support is not registered for this feature yet. | [1](../features/ci.md), [2](../features/build-scopes.md), [3](../../development/features/workbench.md) |
<!-- skillset:generated:end provider-feature-support -->

## Runtime Evidence Boundary

The local Cursor CLI can smoke-test isolated renderings, but runtime evidence remains separate from compile-target support. A successful [build](../../glossary.md#build) does not prove that Cursor trusted, discovered, or invoked the generated artifact. See the [Cursor provider ADR](../../adrs/0002-cursor-is-a-first-class-provider.md) and [runtime adapters](../../development/features/runtime-adapters.md).

Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](../../start/build-versus-activation.md).

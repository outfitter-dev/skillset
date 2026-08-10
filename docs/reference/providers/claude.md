---
description: Explains how Skillset renders adaptive and Claude-native source into Claude provider output.
---

# Claude Provider

Provider id: `claude`

The Claude [target](../../glossary.md#target) [renders](../../glossary.md#render) project guidance under `.claude/` and plugin bundles with a native `.claude-plugin/plugin.json` manifest as [generated output](../../glossary.md#generated-output). [Adaptive source](../../glossary.md#adaptive-source) remains [canonical source](../../glossary.md#canonical-source); Claude-only behavior belongs in explicit [provider-native](../../glossary.md#provider-native) source or Claude-scoped overrides.

## Provider Shape

Claude plugin manifests can declare native component roots for skills, commands, agents, hooks, MCP servers, LSP servers, output styles, themes, and monitors. Executable helpers under `bin/` are provider-native. Default plugin settings remain outside Skillset's v1 [activation](../../glossary.md#activation) authority: a [build](../../glossary.md#build) may render definitions, but it does not enable a plugin or mutate live Claude settings.

Project agents render as Claude Markdown under `.claude/agents/`. Adaptive instruction source renders as Claude rules, preserving path scopes where the provider supports them. Provider-native files remain separate from adaptive source so Claude-specific semantics are visible rather than presented as portable.

For exact source and [destination](../../glossary.md#destination) behavior, use the feature pages for [plugins](../features/plugins.md), [agents](../features/agents.md), [instructions](../features/instructions.md), [hooks](../features/hooks.md), and [tools policy](../features/tools-policy.md).

## Feature Support

<!-- skillset:generated:start provider-feature-support -->
| Feature | Feature status | Target support | Qualification | Docs |
| --- | --- | --- | --- | --- |
| Activation Probes | `implemented` | `not_applicable` | — | [1](../features/tests-and-evals.md) |
| Adaptive Hooks | `implemented` | `transformed` | — | [1](../features/hooks.md) |
| Changes | `implemented` | `not_applicable` | — | [1](../features/changes.md) |
| Dependencies | `implemented` | `native` | — | [1](../features/dependencies.md) |
| Dev Watch | `implemented` | `not_applicable` | — | [1](../features/dev-watch.md) |
| Distributions | `implemented` | `not_applicable` | — | [1](../features/distributions.md) |
| Feature Registry | `implemented` | `not_applicable` | — | [1](../../development/features/feature-registry.md) |
| Future Companion Source Pointers | `planned` | `planned` | — | [1](../features/apps.md), [2](../features/hooks.md), [3](../features/commands.md), [4](../features/settings.md) |
| Marketplaces | `implemented` | `native` | — | [1](../features/marketplaces.md) |
| Output Safety | `implemented` | `not_applicable` | — | [1](../features/output-safety.md) |
| Plugin Agents | `implemented` | `pass_through` | — | [1](../features/agents.md) |
| Codex Plugin Apps | `implemented` | `not_applicable` | — | [1](../features/apps.md) |
| Plugin Assets | `implemented` | `pass_through` | — | [1](../features/plugins.md) |
| Plugin Bin | `implemented` | `pass_through` | — | [1](../features/executables.md), [2](../features/feature-source-pointers.md) |
| Plugin Commands | `implemented` | `pass_through` | — | [1](../features/commands.md), [2](../features/plugins.md) |
| Plugin Hooks | `implemented` | `pass_through` | — | [1](../features/hooks.md) |
| Plugin LSP Servers | `implemented` | `pass_through` | — | [1](../features/lsp-servers.md), [2](../features/plugins.md) |
| Plugin Manifests | `implemented` | `native` | — | [1](../features/plugins.md) |
| Plugin MCP Servers | `implemented` | `native` | — | [1](../features/feature-source-pointers.md), [2](../features/mcp-servers.md) |
| Plugin Monitors | `implemented` | `pass_through` | — | [1](../features/monitors.md), [2](../features/plugins.md) |
| Plugin Output Styles | `implemented` | `pass_through` | — | [1](../features/output-styles.md), [2](../features/plugins.md) |
| Plugin README | `implemented` | `pass_through` | — | [1](../features/plugins.md) |
| Plugin Rules | `implemented` | `not_applicable` | — | [1](../features/instructions.md), [2](../features/plugins.md) |
| Plugin Scripts | `implemented` | `pass_through` | — | [1](../features/plugins.md) |
| Plugin Skills | `implemented` | `native` | — | [1](../features/plugins.md), [2](../features/skills.md) |
| Plugin Source | `implemented` | `pass_through` | — | [1](../features/plugins.md) |
| Plugin Themes | `implemented` | `pass_through` | — | [1](../features/themes.md), [2](../features/plugins.md) |
| Project Agents | `implemented` | `native` | — | [1](../features/agents.md) |
| Project Instructions | `implemented` | `transformed` | — | [1](../features/instructions.md) |
| Releases | `implemented` | `metadata_only` | — | [1](../features/releases.md) |
| Render Results | `implemented` | `not_applicable` | — | [1](../../development/features/render-results.md) |
| Resources | `implemented` | `native` | — | [1](../features/resources.md) |
| Runtime Adapters | `planned` | `not_applicable` | — | [1](../../development/features/runtime-adapters.md) |
| Runtime Context | `implemented` | `transformed` | Normalized fields are provider, hook.event, and session.id; raw Claude environment remains available to the hook command. | [1](../features/hooks.md), [2](../../development/features/hook-guardrails.md) |
| Standalone Skills | `implemented` | `native` | — | [1](../features/skills.md) |
| Supports | `implemented` | `metadata_only` | — | [1](../features/supports.md) |
| Provider Source | `implemented` | `pass_through` | — | [1](../features/target-native-islands.md) |
| Tools Policy | `implemented` | `transformed` | Portable keys lower to allowed-tools / disallowed-tools preapproval and denial rules; native overlay strings pass through verbatim. | [1](../features/tools-policy.md) |
| Version Audit | `implemented` | `not_applicable` | — | [1](../features/version-audit.md) |
| Workflows | `implemented` | `not_applicable` | — | [1](../features/ci.md), [2](../features/build-scopes.md), [3](../../development/features/workbench.md) |
<!-- skillset:generated:end provider-feature-support -->

## Evidence Boundary

Implemented provider claims are backed by checked-in destination-format snapshots, schema snapshots or manual overlays, and rendering tests. The generated table reports registry status; it does not replace provider-specific review when Claude changes a native format.

Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](../../start/build-versus-activation.md).

---
description: Plugins define source containers, manifest authority, component ownership, and provider bundle boundaries.
---

# Plugins

<!-- skillset:generated:start feature-support -->
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
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

A plugin is a source container that preserves one product identity while generating separate [provider-native](../../glossary.md#provider-native) bundles. Source lives at `.skillset/plugins/<plugin>/` with a plugin-local `skillset.yaml`; default output lives at `plugins/<plugin>/<target>/`.

## Source Contract

The directory name is the plugin identity. `skillset.name`, when present, must agree with it; `skillset.id` is invalid.

```yaml
skillset:
  name: review-tools
  description: Review automation and guidance.
  author:
    name: Example Team
  listing:
    display_name: Review Tools
    summary: Review changes with shared automation.
    category: Developer Tools
    keywords: [review, automation]
```

Core identity and provenance fields live directly under `skillset`. Discovery and presentation fields live under `skillset.listing` with snake_case keys. The generated [plugin configuration schema](../schemas/README.md) owns the accepted fields; [project configuration](../../configuration/project-configuration.md) and [target overrides](../../configuration/target-overrides.md) own root selection and provider defaults.

`skillset.author` accepts a name string as shorthand or an object with required `name` and optional `email` and `url`. Canonical source may retain additional author fields, but provider renderers emit only fields their native destination supports. A field that cannot be represented is named in the structured rendering result instead of being copied into generic destination metadata.

Portable [skills](skills.md) and their [resources](resources.md) remain inside the plugin boundary. Other component paths have their own owners: [agents](agents.md), [instructions](instructions.md), [hooks](hooks.md), [MCP](mcp-servers.md), [executables](executables.md), and [provider source](target-native-islands.md). The generated matrix above is authoritative for provider availability.

## Provider Output

Each enabled [target](../../glossary.md#target) receives a separate bundle and native manifest:

```text
plugins/review-tools/claude/.claude-plugin/plugin.json
plugins/review-tools/codex/.codex-plugin/plugin.json
plugins/review-tools/cursor/.cursor-plugin/plugin.json
```

The compiler derives component wiring from source layout and feature configuration. Copied scripts preserve source executable intent and render with mode `0755` on Unix; other generated files render with mode `0644`.

### Plugin-Owned Claude Bundle Destinations

A plugin may own the exact workspace-relative root of its Claude bundle with `claude.bundle.path` in its plugin-local `skillset.yaml`:

```yaml
skillset:
  name: trails
claude:
  bundle:
    path: plugin
```

The destination becomes the compiler-owned root for the complete Claude bundle — manifest, skills, hooks, agents, provider-native islands, executables, copied companions, and selected license artifacts — with no implicit `plugins/<plugin>` or provider segment:

```text
plugin/.claude-plugin/plugin.json
plugin/skills/**
plugin/hooks/**
plugin/skillset.lock
```

The workspace-wide `claude.plugins.path` continues to select the marketplace root and the container for default-shaped bundles. With its default value, the marketplace stays at `.claude-plugin/marketplace.json` and references this bundle as `source: ./plugin`. The [plugin configuration schema](../schemas/0.1.0/plugin-config.schema.json) owns `claude.bundle.path`; workspace configuration and other provider blocks reject this field.

For a custom marketplace root, the bundle destination remains workspace-relative and must be beneath that root. For example, workspace `claude.plugins.path: dist` and plugin `claude.bundle.path: dist/trails` render `dist/.claude-plugin/marketplace.json`, `dist/trails/.claude-plugin/plugin.json`, and marketplace source `./trails`. A sibling destination such as `plugin` cannot be referenced from the `dist` marketplace: [Claude local marketplace sources](https://code.claude.com/docs/en/plugin-marketplaces#relative-paths) cannot leave the marketplace root. Skillset rejects this combination with the conflicting roots rather than relocating either output.

Each explicit bundle carries its own `skillset.lock` and participates in `explain`, `diff`, and `check --only outputs` provenance. A custom marketplace container may hold both independently locked bundles and default-shaped sibling bundles. Destinations cannot reuse the container itself, overlap another plugin bundle, source tree, marketplace metadata directory, skill output root, or another target's output roots. Case-conflicting destinations are rejected consistently across hosts.

## Manifest Authority

Every generated field has one writer:

| Field family | Authority |
| --- | --- |
| Name, description, author, homepage, repository, license, listing | canonical plugin source |
| Version | release state, with source version as fallback |
| Component paths and dependency wiring | compiler |
| Verified provider-only values | `claude.manifest`, `codex.manifest`, or `cursor.manifest` source override |

Provider manifest overrides remain target-local, but they cannot compete with compiler-owned component wiring or Claude dependency fields. Generated manifests are [generated output](../../glossary.md#generated-output), not authoring surfaces.

For Claude Code 2.1.143 and later, `skillset.listing.display_name`
renders to the plugin manifest's `displayName`. The provider-native
`claude.manifest.displayName` override wins over that canonical default without
changing `name` or component namespaces. A marketplace entry's `displayName`
has UI precedence over the plugin manifest, so an explicit
`claude.marketplace.displayName` is the narrowest label override and omission
from the entry preserves Claude's manifest fallback.

## Errors and Caveats

Skillset rejects identity conflicts, unsupported config keys, competing field authority, unsafe source pointers, generated-root overlap, divergent features targeting the same path, and unmanaged [destination](../../glossary.md#destination) collisions. It also rejects Codex-enabled plugin agents and Codex plugin `.rules` because neither has a documented Codex plugin surface.

Import compares native candidates using manifest identity plus deterministic non-manifest evidence. Conflicting portable values or divergent same-identity roots stop adoption instead of choosing a provider arbitrarily. See [importing existing content](../../guides/importing.md) for the workflow.

## Provenance

Plugin lock entries record resolved version authority, included and skipped skills, target state, source and output hashes, file modes, and feature-key components. [`skillset explain`](../cli/explain.md) traces a plugin or generated file back to those decisions; [`skillset check --only outputs`](../cli/check.md) detects stale manifests and bundle files.

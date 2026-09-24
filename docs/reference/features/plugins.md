---
description: Plugins define source containers, manifest authority, component ownership, and provider bundle boundaries.
---

# Plugins

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-assets` | `implemented` | `not_applicable` | `pass_through` | `planned` |
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

A plugin is a source container that preserves one product identity while generating one package shared by every enabled [target](../../glossary.md#target). Source lives at `.skillset/plugins/<plugin>/` with a plugin-local `skillset.yaml`; output lives at `plugins/<plugin>/`.

Create an empty container with `skillset new plugin <name> --yes`. The command previews by default, validates the same plugin identity the resolver will load, and creates `skillset.yaml`, `README.md`, and an empty `skills/` placeholder. Add the first skill with `skillset new skill <name> --in <plugin> --yes`; plugin containers cannot nest.

When Agent Plugins 1.0 is adopted, its portable manifest, skill tree, and neutral support files form the package baseline. Enabled providers add their manifest and supported components beside that baseline instead of creating provider subpackages.

Root `plugins.internal_use` selects and reports project-local plugin content,
defaulting to none. Selected live skills render as separately owned project-use
copies in enabled provider skill roots; plugin-level components do not
accompany those copies. Root `plugins.output` is parsed into a deterministic package
path plan; current builds accept only the default `plugins/[name]` placement.
Custom paths, root placement, `name`, and `combine` remain explicit unsupported
results until their package-placement features land rather than being silently
ignored.

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

Each enabled [target](../../glossary.md#target) contributes to one package:

```text
plugins/review-tools/plugin.json
plugins/review-tools/.claude-plugin/plugin.json
plugins/review-tools/.cursor-plugin/plugin.json
plugins/review-tools/skills/<effective-name>/SKILL.md
plugins/review-tools/assets/**
```

Authored skill grouping directories organize source only. Generated package skills are immediate children named by their effective skill names. Skillset compares provider renderings before writing: provider-only frontmatter keys can coexist, while conflicting values or body bytes fail with a provider-specific diagnostic. Two sources that flatten to the same effective name also fail and name both sources.

The Agent Plugins baseline owns the portable root manifest, shared skill tree, portable `mcp.json`, and recognized neutral support files. Claude and Cursor manifests remain in their documented metadata directories. Package presentation assets are copied once to root `assets/`; skill-local assets and declared `shared:` or `plugin:` resources remain inside their skill directory. The pinned Cursor evidence documents a relative logo but does not establish arbitrary package assets as a native component, so the generated support matrix keeps Cursor asset support planned.

The compiler derives component wiring from the final package inventory. Claude's `skills` field points to `./skills/` for the generated immediate-child skill tree; explicit path arrays remain available for genuinely nonstandard routing. Copied scripts preserve source executable intent and render with mode `0755` on Unix; other generated files render with mode `0644`. Any two package producers that require different bytes or modes at the same path fail with `plugin-package-path-conflict` before a write.

`claude.bundle.path` cannot split the shared package. Custom package placement remains reserved for SET-561; current package planning accepts only the default `plugins/[name]` placement.

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

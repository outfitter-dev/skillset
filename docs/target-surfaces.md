# Provider Surface Evidence Matrix

This is the cheap-to-refresh map between Skillset source and the provider surfaces it builds. It exists so provider drift is caught deliberately: each surface row has a **status** and, where it depends on provider-owned destination formats, an adopted snapshot in `@skillset/registry`. Golden manifest tests in `apps/skillset/src/__tests__/contract.test.ts` and `apps/skillset/src/__tests__/skillset.test.ts` pin the generated shapes that these rows claim.

Refreshing is intentionally cheap but explicit: re-read the linked provider docs, update the normalized snapshot with its fetched timestamp and content hash, then adjust the affected row and golden test if the surface changed. Ordinary build and check paths must not fetch provider docs.

`@skillset/registry` also records rolling-latest provider schema sources for maintainer checks: Claude Code settings, plugin manifests, marketplaces, and keybindings; Codex config, hooks config, hook event schemas, and skill metadata. Those schema snapshots store source URLs, upstream content hashes, fetched timestamps, normalized summaries, and deterministic snapshot hashes. Destination areas with no adopted JSON Schema source are represented as manual overlays linked back to the docs-backed format snapshots rather than left as silent gaps.

Maintainers refresh that evidence explicitly with `skillset providers check`, `skillset providers diff`, and `skillset providers update --yes`. `check` compares adopted schema source hashes against live upstream sources, `diff` adds readable schema summary changes plus explicit manual-review rows for prose-only destination format snapshots, and `update --yes` rewrites `packages/registry/src/schema-snapshots.ts` with refreshed schema summaries and provenance. Destination format snapshots are not machine-diffed until their source rows carry a machine-readable upstream baseline. Ordinary user builds, checks, and generated-output verification remain offline.

Known safe update paths live in `packages/registry/src/migrations.ts`. Add a registry entry when a provider destination-format change is understood well enough to classify as `compatible`, `adapter-only`, `source-migration`, `unsupported-drift`, or `manual-review`. Each entry must name the provider, destination surface, source and destination snapshot versions, safety and preview flags, confirmation requirement, and the adopted snapshot ids it applies to. Leave unreviewed or lossy changes unregistered so callers route them to manual review instead of rewriting source.

`skillset check` reports generated-output drift that maps to safe provider destination-format migrations without writing. `skillset check --fix` and `skillset update --yes` apply only source-preserving safe plans; unregistered or manual-review drift blocks writes and prints the affected outputs.

Provider-format evidence and migration changes are package-facing when they touch `packages/registry/src/**` or `packages/registry/package.json`. Record compatible refreshes, safe destination-format migrations, and manual-review drift in the package Changeset with the same class names that users see in diagnostics. Add a Skillset pending change entry when the target rendering model, provider support promise, or generated-output behavior changes in this workspace; leave pure docs clarification as docs-only unless it changes release-visible behavior.

User-facing destination-format diagnostics should name the provider, destination, source unit, affected output, and next command or review step. Safe preview output looks like:

```text
  safe destination update: Codex plugin
    source: plugin.alpha.config:root
    action: Codex plugin manifests can derive dotted relative component paths during rendering.
    output: plugins/alpha/codex/.codex-plugin/plugin.json
    next: run skillset update --yes
skillset: destination-format check found 1 safe update, 0 manual reviews, and 0 unplanned drift paths
```

Manual-review output is deliberately different and blocks writes:

```text
  manual review required: Codex agent
    source: agent:reviewer
    reason: Codex custom-agent TOML source changes require maintainer review before rewriting source.
    output: .codex/agents/reviewer.toml
    next: review the generated output and update Skillset source or provider support before writing
skillset: destination-format update found 0 safe updates, 1 manual review, and 0 unplanned drift paths
skillset: destination-format updates require manual review before writing
```

Unsupported destination policies keep their own language: `error` fails before writes, `warn` keeps the destination issue visible without failing, `skip` records that no unsupported destination output was written, and `force` records an explicit override without pretending the unsupported behavior became portable.

Source examples use `<source-root>` as shorthand for the canonical `.skillset/` source root.

## Support vocabulary

- **Implemented** — Skillset parses, validates, renders, tests, and documents this surface today.
- **Adaptive** — authored once as Skillset source because the provider outcomes share the same intent and can be meaningfully adapted.
- **Provider-native** — supported only through one provider's native source or adapter path; not adaptive by default.
- **Metadata-only** — captured in generated metadata or lock provenance, not target-enforced behavior.
- **Planned** — accepted doctrine or a draft/accepted ADR, but parser/render support has not landed yet.
- **Reserved** — accepted vocabulary that currently fails with a clear diagnostic until supporting provenance lands.
- **Deferred** — intentionally not rendered yet; the reason is documented and this is not a gap to fill silently.
- **Unsupported** — cannot build to an enabled provider destination without explicit provider scoping or a visible unsupported destination policy result.
- **Lossy** — a possible render would drop behavior or target meaning; v1 treats lossy render as unsupported unless a future ADR defines visible provenance.
- **Future** — intentionally outside the v1 contract, tracked so later design does not accidentally masquerade as current support.

Default behavior for unsupported or lossy build results is fail-loud. Softer modes must record visible warnings, skipped-source provenance, or force provenance before they can be treated as safe.

## Cursor provider baseline

Cursor provider support is implemented as a first-class compile target, not a
Claude or Codex compatibility shim. The contract is defined by the [Cursor provider
ADR](adrs/drafts/20260702-cursor-is-a-first-class-provider.md). Provider evidence
was live-doc checked on 2026-07-02 against the official Cursor docs.

Cursor participates in the default provider plan. Repos can still narrow
provider output with explicit `compile.targets` when they do not want Cursor
artifacts.

| Cursor surface | Cursor destination | Status | Notes |
| --- | --- | --- | --- |
| Skills | `.cursor/skills/<skill>/SKILL.md` | Implemented | Project-level Cursor skills use `SKILL.md`; plugin skills live under plugin-root `skills/`. |
| Rules | `.cursor/rules/**/*.mdc` | Implemented | Skillset renders project and plugin rules as Cursor `.mdc` files with Cursor frontmatter. |
| Project subagents | `.cursor/agents/*.md` | Implemented | Cursor frontmatter includes `name`, `description`, `model`, `readonly`, and `is_background`; Cursor-specific fields stay provider-native until portable intent is proven. |
| Plugins | `.cursor-plugin/plugin.json` plus plugin-root components | Implemented | Components include `rules/`, `skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `mcp.json`, `assets/`, `scripts/`, and source companions. |
| Marketplace | `.cursor-plugin/marketplace.json` | Implemented | Multi-plugin repository catalog surface for generated local plugins. External plugin references remain governed by marketplace config and lock provenance. |
| MCP | plugin-root `mcp.json` with `mcpServers` | Implemented | Cursor receives plugin-root `mcp.json`; manifest `mcpServers` is declared for the generated component path. |
| Hooks | plugin-root `hooks/hooks.json` | Implemented | Cursor events are lower-camel provider-native names such as `sessionStart`, `beforeShellExecution`, `afterFileEdit`, `beforeSubmitPrompt`, `preCompact`, and `workspaceOpen`. |
| Provider-native source | `<source-root>/_cursor/**` and `<source-root>/plugins/<plugin>/_cursor/**` | Implemented | Native source remains provider-native by default and is lifted to adaptive source only when registry facts prove a faithful mapping. |
| Runtime smoke | local `agent` / `cursor-agent` CLI | Implemented | Runtime tester uses isolated workspaces, `--print`, `--output-format`, `--mode ask`, `--plugin-dir`, `--trust`, and `--workspace`; build does not install, trust, or mutate user-level Cursor config. |

## Source contract

| Source | Renders to | Status | Notes |
| --- | --- | --- | --- |
| `skillset.schema` (int) | (source-only) | Implemented | Source-contract marker, separate from `skillset.version`; never in generated output. |
| root/plugin `skillset.version` (semver) | plugin manifest `version`, fallback skill `metadata.version` | Implemented | Content version; generated drift reported by `skillset check --only outputs`. |
| skill top-level `version` (semver) | skill `metadata.version` | Implemented | Skill-local version; release state wins after `skillset release apply`. |
| `skillset.name` | machine identity | Implemented | Root and plugin explicit identity; directory names remain the default. `skillset.id` is unsupported. |
| skill top-level `name` | skill identity | Implemented | Skill-local `skillset.name` / `skillset.id` are unsupported. |
| root/plugin/skill `skillset.license` or local `LICENSE.txt` | managed `LICENSE.txt`; plugin manifest `license` when declared in plugin metadata | Implemented | Supports `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `MIT`, `MPL-2.0`, and `none`; child scopes inherit unless overridden or opted out. |
| `compile.targets` | enabled provider outputs | Implemented | Root-only provider selection; accepts `claude`, `codex`, and `cursor`. Defaults include all three first-class providers. |
| `compile.build: updated/all` | normalized build mode in lock provenance | Implemented | Parser, CLI overrides, plan-first writes, and lock metadata are implemented. |
| `compile.features.promptArguments` | `{{$ARGUMENTS...}}` adaptive command placeholders | Implemented | Defaults to `true`; set to `false` to reject the source markers. |
| `compile.skillset.metadata: false` | suppress generated skill `metadata.generated` / `metadata.version` | Implemented | Source metadata remains source-only; locks record `skillsetMetadata`. |
| `compile.unsupportedDestination: error` | build/diff/verify unsupported destination policy | Implemented | Default policy; preserves current fail-loud unsupported behavior. |
| `compile.unsupportedDestination: warn/skip/force` | diagnostics, doctor, lock provenance | Implemented | Non-error policies soften unsupported/lossy render results only; failed render results still block. |
| omitted `compile.targets` | default provider outputs | Implemented | Equivalent to `compile.targets: [claude, codex, cursor]`. |
| `<provider>.projectRoot` | provider adapter metadata | Implemented | Parsed and inherited with provider blocks; build still does not mutate user-level config. |
| `<provider>.userRoot` | provider adapter metadata | Implemented | Parsed and inherited with provider blocks for future setup/explain flows. |
| `<provider>.defaults.<surface>` | provider option defaults for `agents`, `instructions`, `plugins`, `skills` | Implemented | Canonical provider-local defaults; file-level provider fields win. |
| `defaults.<provider>.<surface>` | same provider option defaults | Implemented | Root/plugin shorthand; does not introduce bare top-level `targets:` provider selection. |
| skill top-level `model` | (source-only warning) | Implemented | Warns unless every enabled provider has a provider-specific model or provider defaults. |
| `profiles.models` / `model_profile` | provider-native model and reasoning fields | Future | Deferred alias design for repo-local model intent names; see the [model and reasoning alias profiles ADR](adrs/drafts/20260604-model-and-reasoning-alias-profiles.md). |
| `.skillset/sets/<name>/set.yaml` / `set:<name>` | focused generated-output selection and future marketplace/bundle indexes | Future | Deferred collection design for grouped marketplaces, bundles, and curated loadouts; see the [first-class sets ADR](adrs/drafts/20260604-first-class-sets.md). |

Canonical provider selection:

```yaml
compile:
  targets:
    - claude
    - codex
    - cursor
  unsupportedDestination: error
```

Shorthand provider selection with the same internal provider plan:

```yaml
compile:
  targets: [claude, codex, cursor]
```

When `compile.targets` is omitted, Skillset also normalizes to the same all-supported-provider plan. Provider-specific `claude`, `codex`, and `cursor` blocks configure native output details and nested opt-outs; they are not a second provider-selection surface.

Adapter defaults deliberately use explicit provider blocks such as `claude`, `codex`, and `cursor`, or the `defaults.<provider>` shorthand, not a top-level `targets:` map. That preserves the ADR-0001 boundary: `compile.targets` selects provider outputs, while provider blocks carry provider-native config and scoped overrides.

## Plugin manifest (Claude `.claude-plugin/plugin.json`)

Live-doc verified against `code.claude.com/docs/en/plugins` and `code.claude.com/docs/en/plugins-reference` (2026-06-04).

| Source presence | Manifest field | Status | Notes |
| --- | --- | --- | --- |
| always | `name`, `version`, `description` | Implemented | |
| `skills/` | `skills: "./skills/"` | Implemented | |
| `commands/` | `commands: "./commands"` | Implemented | |
| `agents/` | `agents: "./agents"` | Implemented | |
| `hooks/hooks.json` | `hooks: "./hooks/hooks.json"` | Implemented | |
| `.mcp.json` | `mcpServers: "./.mcp.json"` | Implemented | Conventional `.mcp.json` and `mcp.source` copy into Claude plugin output and are locked as plugin features. |
| `.lsp.json` | `lspServers: "./.lsp.json"` | Implemented | |
| `output-styles/` | `outputStyles: "./output-styles/"` | Implemented | |
| `themes/` | `experimental.themes: "./themes/"` | Implemented | |
| `monitors/monitors.json` | `experimental.monitors: "./monitors/monitors.json"` | Implemented | |
| `bin/` | executable PATH component | Provider-native / Implemented | Documented Claude plugin-root component; conventional `bin/` and `bin.source` copy into Claude plugin output and are locked as plugin features. |
| `settings.json` | default plugin settings | Provider-native / Future | Documented Claude plugin-root component for enabled plugins. Skillset v1 does not mutate live settings; the [reviewed settings suggestion workflow](adrs/drafts/20260604-reviewed-settings-suggestions.md) is future work. |

## Project agents (Claude)

Live-doc verified against `code.claude.com/docs/en/sub-agents` (2026-06-04).

| Source | Claude output | Status |
| --- | --- | --- |
| `<source-root>/agents/*.md` | project `.claude/agents/*.md` | Portable / Implemented |
| user `~/.claude/agents/*.md` | user custom agents | Future |

## Plugin manifest interface (Codex `.codex-plugin/plugin.json`, `interface`)

Camel-cased presentation fields derived from portable `presentation` / `ui` metadata. Pinned by the Codex-interface golden test.

| Source (`presentation.*`, snake or camel) | Codex `interface` field | Status |
| --- | --- | --- |
| `display_name` / title | `displayName` | Implemented |
| `summary` / `short_description` | `shortDescription` | Implemented |
| `description` / `long_description` | `longDescription` | Implemented |
| `developer_name` / author name | `developerName` | Implemented |
| `category` | `category` | Implemented |
| `capabilities` | `capabilities` | Implemented |
| `website_url` / homepage | `websiteURL` | Implemented |
| `default_prompt` | `defaultPrompt` | Implemented |
| `color` / `brand_color` | `brandColor` | Implemented (defaults to `#B06DFF`) |

## Plugin companion paths (Codex)

Live-doc verified against `developers.openai.com/codex/plugins/build` and `developers.openai.com/codex/subagents` (2026-06-04).

| Source | Codex output | Status | Notes |
| --- | --- | --- | --- |
| `hooks/hooks.json` (canonical) | `hooks/hooks.json` (top-level `hooks` object) | Implemented | |
| root `hooks.json` | n/a | Unsupported | Use `hooks/hooks.json`; root hook files are rejected before build. |
| `.mcp.json` | `.mcp.json` | Implemented | Conventional `.mcp.json` and `mcp.source` copy into Codex plugin output and are locked as plugin features. |
| `.app.json` | `.app.json` (manifest `apps`) | Implemented | Opaque pass-through. |
| plugin `agents/` | (none) | Unsupported / Deferred | Codex plugin docs do not document a plugin `agents/` component. Do not copy Claude plugin agents here. |
| `<source-root>/agents/*.md` | project `.codex/agents/*.toml` | Adaptive / Implemented | Codex documents project/user custom agents as standalone TOML files. Skillset builds adaptive project agents into project custom agents; plugin-agent output remains unsupported. |
| user `~/.codex/agents/*.toml` | user custom agents | Future | User/global writes need explicit setup/review flows and must not happen as a side effect of `skillset build`. |

## Instructions

| Source | Claude output | Codex output | Status |
| --- | --- | --- | --- |
| `<source-root>/rules/**/*.md` | `.claude/rules/**/*.md` (`paths` kept) | `AGENTS.md` at derived dirs, source-boundary comments | Implemented |
| `<source-root>/_codex/rules/**/*.rules` | n/a | `.codex/rules/**/*.rules` | Provider-native / Implemented — Codex command execution policy, not instruction Markdown. |

Codex truncates `AGENTS.md` beyond `project_doc_max_bytes` (32 KiB default); `skillset build`/`verify` warns. Verified 2026-06-03 (`developers.openai.com/codex/guides/agents-md`, `openai/codex#7138`).

Codex discovers project guidance from `AGENTS.md` files at the repo root and scoped directories. Skillset should not render default Codex project guidance to `.codex/AGENTS.md`; `.codex/` is for Codex configuration surfaces such as agents, hooks, rules, and config files.

Codex `.rules` files are execution policy for shell command approval, prompt, or denial decisions. They are not a replacement for Skillset instruction Markdown, and moving prose guidance into `.rules` would be a lossy render.

## Hooks validation

Verified 2026-07-02 against the provider capability registry, Codex hook schema snapshots, Claude hooks reference, and Cursor hooks docs. Provider-native hook validation is registry-backed for Claude, Codex, and Cursor.

| Concern | Claude | Codex | Status |
| --- | --- | --- | --- |
| JSON-object shape | required | required | Implemented |
| Supported events | registry allowlist | registry allowlist | Implemented |
| Handler types | event-specific registry allowlist | synchronous `command` only | Implemented |
| `async: true` command handlers | allowed | rejected (parsed-but-skipped) | Implemented |

## Tool policy

| Source | Claude output | Codex output | Status |
| --- | --- | --- | --- |
| `tools` | `allowed-tools` / `disallowed-tools` (preapproval and denial rules) | `.skillset.tools.yaml` metadata | Implemented / Metadata-only (Codex) |
| `tool_intent` | n/a | n/a | Retired — use `tools`. |
| `allowed_tools` | `allowed-tools` | unset/false only | Implemented (Claude); Codex has no skill-local surface. |
| `tools.<provider>.allow` / `deny` | native rules | `.skillset.tools.yaml` `target_native` | Implemented (provider-native block) |

# Target Surface Evidence Matrix

This is the cheap-to-refresh map between Skillset source and the Claude/Codex target surfaces it lowers to. It exists so target drift is caught deliberately: each surface row has a **status** and, where it depends on live provider docs, a **verified** date and source. Golden manifest tests in `src/__tests__/contract.test.ts` and `src/__tests__/skillset.test.ts` pin the generated shapes that these rows claim.

Refreshing is intentionally cheap: re-read the linked provider docs, update the verified date, and adjust a row + its golden test if the surface changed.

## Support vocabulary

- **Implemented** — Skillset parses, validates, renders, tests, and documents this surface today.
- **Compat alias** — accepted legacy or native spelling that lowers to the canonical source form; warned or documented as deprecated.
- **Portable** — authored once as Skillset source because the target outcomes share the same intent.
- **Target-native** — supported only through one target's native source or adapter path; not portable by default.
- **Metadata-only** — captured in generated metadata or lock provenance, not target-enforced behavior.
- **Planned** — accepted doctrine or a draft/accepted ADR, but parser/render support has not landed yet.
- **Reserved** — accepted vocabulary that currently fails with a clear diagnostic until supporting provenance lands.
- **Deferred** — intentionally not emitted yet; the reason is documented and this is not a gap to fill silently.
- **Unsupported** — cannot lower to an enabled target without explicit target scoping or a visible unsupported policy outcome.
- **Lossy** — a possible lowering would drop behavior or target meaning; v1 treats lossy lowering as unsupported unless a future ADR defines visible provenance.
- **Future** — intentionally outside the v1 contract, tracked so later design does not accidentally masquerade as current support.

Default behavior for unsupported or lossy lowering is fail-loud. Softer modes must record visible warnings, skipped-source provenance, or force provenance before they can be treated as safe.

## Source contract

| Source | Lowers to | Status | Notes |
| --- | --- | --- | --- |
| `skillset.schema` (int) | (source-only) | Implemented | Source-contract marker, separate from `skillset.version`; never in generated output. |
| `skillset.version` (semver) | plugin manifest `version`, skill `metadata.version` | Implemented | Content version; drift reported by `skillset check`. |
| `skillset.name` / `skillset.id` | machine identity | Implemented / Compat alias | Identity derives from directory names; `skillset.id` is the alias. |
| skill top-level `name` | skill identity | Implemented | Conflicts with `skillset.name` fail. |
| `compile.targets` | enabled provider projections | Implemented | Root-only provider selection; defaults to all supported targets. |
| `compile.build: updated/all` | normalized build mode in lock provenance | Implemented | Parser, CLI overrides, plan-first writes, and lock metadata are implemented. |
| `compile.skillset.metadata: false` | suppress generated skill `metadata.generated` / `metadata.version` | Implemented | Source metadata remains source-only; locks record `skillsetMetadata`. |
| `compile.unsupported: error` | build/lint lowering policy | Implemented | Default policy; preserves current fail-loud unsupported behavior. |
| `compile.unsupported: warn/skip/force` | doctor/lock provenance | Reserved | Recognized names that fail until skipped or forced source is visible. |
| omitted `compile.targets` | all supported provider projections | Implemented | Shorthand for the default target plan; equivalent to `compile.targets: [claude, codex]` while both providers are supported. |
| `claude.projectRoot` / `codex.projectRoot` | target adapter metadata | Implemented | Parsed and inherited with provider blocks; build still does not mutate user-level config. |
| `claude.userRoot` / `codex.userRoot` | target adapter metadata | Implemented | Parsed and inherited with provider blocks for future setup/explain flows. |
| `claude.defaults.<surface>` / `codex.defaults.<surface>` | target option defaults for `agents`, `instructions`, `plugins`, `skills` | Implemented | Canonical target-local defaults; file-level target fields win. |
| `defaults.<target>.<surface>` | same target option defaults | Implemented | Root/plugin shorthand; does not introduce bare top-level `targets:` provider selection. |
| skill top-level `model` | (source-only warning) | Implemented | Warns unless every enabled target has `claude.model`, `codex.model`, or target defaults. |
| `profiles.models` / `model_profile` | target-native model and reasoning fields | Future | Deferred alias design for repo-local model intent names; see the [model and reasoning alias profiles ADR](adrs/drafts/20260604-model-and-reasoning-alias-profiles.md). |
| `.skillset/sets/<name>/set.yaml` / `set:<name>` | focused generated-output selection and future marketplace/bundle indexes | Future | Deferred collection design for grouped marketplaces, bundles, and curated loadouts; see the [first-class sets ADR](adrs/drafts/20260604-first-class-sets.md). |

Canonical target selection:

```yaml
compile:
  targets:
    - claude
    - codex
  unsupported: error
```

Shorthand target selection with the same internal target plan:

```yaml
compile:
  targets: [claude, codex]
```

When `compile.targets` is omitted, Skillset also normalizes to the same all-supported-provider target plan. Target-specific `claude` and `codex` blocks configure native output details and lower-level opt-outs; they are not a second provider-selection surface.

Adapter defaults deliberately use `claude` / `codex` blocks or the `defaults.<target>` shorthand, not a top-level `targets:` map. That preserves the ADR-0001 boundary: `compile.targets` selects provider projections, while provider blocks carry target-native config and scoped overrides.

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
| `bin/` | executable PATH component | Target-native / Implemented | Documented Claude plugin-root component; conventional `bin/` and `bin.source` copy into Claude plugin output and are locked as plugin features. |
| `settings.json` | default plugin settings | Target-native / Future | Documented Claude plugin-root component for enabled plugins. Skillset v1 does not mutate live settings; the [reviewed settings suggestion workflow](adrs/drafts/20260604-reviewed-settings-suggestions.md) is future work. |

## Project agents (Claude)

Live-doc verified against `code.claude.com/docs/en/sub-agents` (2026-06-04).

| Source | Claude output | Status |
| --- | --- | --- |
| `.skillset/src/agents/*.md` | project `.claude/agents/*.md` | Portable / Implemented |
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
| root `hooks.json` | `hooks/hooks.json` (normalized) | Compat alias | Warned. Verified 2026-06-03 (`developers.openai.com/codex/plugins/build`). |
| `.mcp.json` | `.mcp.json` | Implemented | Conventional `.mcp.json` and `mcp.source` copy into Codex plugin output and are locked as plugin features. |
| `.app.json` | `.app.json` (manifest `apps`) | Implemented | Opaque pass-through. |
| plugin `agents/` | (none) | Unsupported / Deferred | Codex plugin docs do not document a plugin `agents/` component. Do not copy Claude plugin agents here. |
| `.skillset/src/agents/*.md` | project `.codex/agents/*.toml` | Portable / Implemented | Codex documents project/user custom agents as standalone TOML files. Skillset lowers portable project agents into project custom agents; plugin-agent lowering remains unsupported. |
| user `~/.codex/agents/*.toml` | user custom agents | Future | User/global writes need explicit setup/review flows and must not happen as a side effect of `skillset build`. |

## Instructions

| Source | Claude output | Codex output | Status |
| --- | --- | --- | --- |
| `.skillset/instructions/**/*.md` | `.claude/rules/**/*.md` (`paths` kept) | `AGENTS.md` at derived dirs, source-boundary comments | Implemented |
| `.skillset/rules/**/*.md` | same | same | Compat alias — warned. |
| `.skillset/src/codex/rules/**/*.rules` | n/a | `.codex/rules/**/*.rules` | Target-native / Implemented — Codex command execution policy, not instruction Markdown. |

Codex truncates `AGENTS.md` beyond `project_doc_max_bytes` (32 KiB default); `skillset build`/`check` warns. Verified 2026-06-03 (`developers.openai.com/codex/guides/agents-md`, `openai/codex#7138`).

Codex discovers project guidance from `AGENTS.md` files at the repo root and scoped directories. Skillset should not lower default Codex project guidance to `.codex/AGENTS.md`; `.codex/` is for Codex configuration surfaces such as agents, hooks, rules, and config files.

Codex `.rules` files are execution policy for shell command approval, prompt, or denial decisions. They are not a replacement for Skillset instruction Markdown, and moving prose guidance into `.rules` would be a lossy lowering.

## Hooks validation

Verified 2026-06-03 (`developers.openai.com/codex/plugins/build`, Claude hooks reference). Claude validation is shape-only by design; Codex is strict.

| Concern | Claude | Codex | Status |
| --- | --- | --- | --- |
| JSON-object shape | required | required | Implemented |
| Supported events | broad (shape-only) | strict allowlist | Implemented |
| Handler types | broad | synchronous `command` only | Implemented |
| `async: true` command handlers | allowed | rejected (parsed-but-skipped) | Implemented |

## Tool policy

| Source | Claude output | Codex output | Status |
| --- | --- | --- | --- |
| `tool_intent` | `allowed-tools` / `disallowed-tools` (preapproval) | `.skillset.tools.yaml` metadata | Implemented / Metadata-only (Codex) |
| `tools` | same | same | Compat alias — conflict if both. |
| `allowed_tools` | `allowed-tools` | unset/false only | Implemented (Claude); Codex has no skill-local surface. |
| `_allow` / `_deny` escapes | native rules | `.skillset.tools.yaml` `target_native` | Implemented (escape hatch) |

# Target Surface Evidence Matrix

This is the cheap-to-refresh map between Skillset source and the Claude/Codex target surfaces it lowers to. It exists so target drift is caught deliberately: each surface row has a **status** and, where it depends on live provider docs, a **verified** date and source. Golden manifest tests in `src/__tests__/contract.test.ts` and `src/__tests__/skillset.test.ts` pin the generated shapes that these rows claim.

Refreshing is intentionally cheap: re-read the linked provider docs, update the verified date, and adjust a row + its golden test if the surface changed.

## Status legend

- **Implemented** — Skillset emits this surface from source today.
- **Compat alias** — accepted source spelling that lowers to the canonical form; warned or documented as deprecated.
- **Metadata-only** — captured in generated metadata / lock provenance, not a target-enforced behavior.
- **Planned** — accepted doctrine or a draft/accepted ADR, but parser/render support has not landed yet.
- **Reserved** — accepted vocabulary that currently fails with a clear diagnostic until supporting provenance lands.
- **Deferred** — intentionally not emitted (with the reason); not a gap to fill silently.

## Source contract

| Source | Lowers to | Status | Notes |
| --- | --- | --- | --- |
| `skillset.schema` (int) | (source-only) | Implemented | Source-contract marker, separate from `skillset.version`; never in generated output. |
| `skillset.version` (semver) | plugin manifest `version`, skill `metadata.version` | Implemented | Content version; drift reported by `skillset check`. |
| `skillset.name` / `skillset.id` | machine identity | Implemented / Compat alias | Identity derives from directory names; `skillset.id` is the alias. |
| skill top-level `name` | skill identity | Implemented | Conflicts with `skillset.name` fail. |
| `compile.targets` | enabled provider projections | Implemented | Root-only provider selection; defaults to all supported targets. |
| `compile.unsupported: error` | build/lint lowering policy | Implemented | Default policy; preserves current fail-loud unsupported behavior. |
| `compile.unsupported: warn/skip/force` | doctor/lock provenance | Reserved | Recognized names that fail until skipped or forced source is visible. |

## Plugin manifest (Claude `.claude-plugin/plugin.json`)

Live-doc verified against `code.claude.com/docs/en/plugins-reference` (2026-06-03).

| Source presence | Manifest field | Status |
| --- | --- | --- |
| always | `name`, `version`, `description` | Implemented |
| `skills/` | `skills: "./skills/"` | Implemented |
| `commands/` | `commands: "./commands"` | Implemented |
| `agents/` | `agents: "./agents"` | Implemented |
| `hooks/hooks.json` | `hooks: "./hooks/hooks.json"` | Implemented |
| `.mcp.json` | `mcpServers: "./.mcp.json"` | Implemented |
| `.lsp.json` | `lspServers: "./.lsp.json"` | Implemented |
| `output-styles/` | `outputStyles: "./output-styles/"` | Implemented |
| `themes/` | `experimental.themes: "./themes/"` | Implemented |
| `monitors/monitors.json` | `experimental.monitors: "./monitors/monitors.json"` | Implemented |
| `settings.json` | (none) | Deferred — install-scope user config, not a plugin component; no-user-config-mutation posture. |
| `bin/` | (none) | Deferred — not a documented Claude plugin component; use `scripts/`. |

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

| Source | Codex output | Status |
| --- | --- | --- |
| `hooks/hooks.json` (canonical) | `hooks/hooks.json` (top-level `hooks` object) | Implemented |
| root `hooks.json` | `hooks/hooks.json` (normalized) | Compat alias — warned. Verified 2026-06-03 (`developers.openai.com/codex/plugins/build`). |
| `.mcp.json` | `.mcp.json` | Implemented |
| `.app.json` | `.app.json` (manifest `apps`) | Implemented (opaque pass-through) |
| `agents/` | (none) | Deferred — Codex agent source model unvalidated (SET-13). |

## Instructions

| Source | Claude output | Codex output | Status |
| --- | --- | --- | --- |
| `.skillset/instructions/**/*.md` | `.claude/rules/**/*.md` (`paths` kept) | `AGENTS.md` at derived dirs, source-boundary comments | Implemented |
| `.skillset/rules/**/*.md` | same | same | Compat alias — warned. |

Codex truncates `AGENTS.md` beyond `project_doc_max_bytes` (32 KiB default); `skillset build`/`check` warns. Verified 2026-06-03 (`developers.openai.com/codex/guides/agents-md`, `openai/codex#7138`).

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

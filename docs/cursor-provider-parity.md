# Cursor Provider Parity Plan

Status: planning draft
Research date: 2026-07-01
Completion horizon: implementation-ready

## Purpose

Skillset currently treats Claude and Codex as the supported provider targets. Cursor has grown enough native agent-loadout surface area that it should be evaluated as the next provider rather than treated as a compatibility side effect of Codex output.

The goal is to support Cursor in a substantially similar way to Claude and Codex:

- authors keep writing source-first Skillset units under `.skillset/`;
- `compile.targets` can include `cursor`;
- generated Cursor output is target-native, deterministic, lock-tracked, and disposable;
- unsupported or lossy Cursor adaptations fail loudly unless an explicit future unsupported-destination policy says otherwise;
- Cursor-specific conventions are normalized intentionally, not hidden behind Claude or Codex names.

This document is not an implementation change. It is the research and execution plan for adding Cursor as a first-class provider.

## Source Evidence

Primary Cursor references used for this plan:

- Cursor docs index: <https://cursor.com/docs>
- Rules: <https://cursor.com/docs/rules>
- Skills: <https://cursor.com/docs/skills>
- Subagents: <https://cursor.com/docs/subagents>
- Plugins: <https://cursor.com/docs/plugins>
- Plugins reference: <https://cursor.com/docs/reference/plugins>
- Hooks: <https://cursor.com/docs/hooks>
- MCP: <https://cursor.com/docs/mcp>
- CLI overview: <https://cursor.com/docs/cli/overview>
- CLI usage: <https://cursor.com/docs/cli/using>
- Headless CLI: <https://cursor.com/docs/cli/headless>

Local evidence:

- `agent --version` reports `2026.06.26-7079533`.
- `agent --help` confirms `--print`, `--output-format text|json|stream-json`, `--workspace`, `--plugin-dir`, `--trust`, `--force`, `--yolo`, `--approve-mcps`, `--mode plan|ask`, and `--worktree`.
- Current Skillset source hardcodes the provider set as `claude | codex` in `packages/schema/src/contracts.ts`, `packages/core/src/types.ts`, `packages/core/src/config.ts`, resolver/render code, runtime tester validation, and provider-format maintenance paths.

## Current Skillset Shape

Cursor support is a cross-cutting provider addition, not a narrow renderer toggle.

Current hard seams:

- `TARGET_NAMES = ["claude", "codex"]` in the schema package.
- `TargetName = "claude" | "codex"` in core types.
- root `compile.targets` defaults to the schema target list.
- root provider blocks are `claude` and `codex`; defaults and feature overrides key off those names.
- output roots have `plugins.<target>` and `skills.<target>` entries for two targets.
- provider source islands use `_claude` and `_codex`.
- project roots default to `.claude` and `.codex`.
- plugin manifests branch between `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`.
- instructions render to Claude `.claude/rules/**/*.md` and Codex `AGENTS.md`.
- project agents render to Claude Markdown and Codex TOML.
- runtime tester only accepts `claude` and `codex`.
- provider-format snapshots and maintenance code track Claude and Codex only.
- docs, fixtures, conformance tests, feature registry rows, and generated schemas all assume two providers.

The clean path is to add `cursor` through the same target contract, then implement surface-by-surface renderers and diagnostics.

## Cursor Provider Model

Add `cursor` as a third provider target:

```yaml
compile:
  targets:
    - claude
    - codex
    - cursor
```

When `compile.targets` is omitted, default to all supported providers after Cursor is implemented. During rollout, there are two viable staging choices:

1. Land `cursor` behind explicit opt-in until enough surface parity is available.
2. Add `cursor` to the default only after skills, instructions, project agents, plugins, hooks, MCP, locks, docs, and conformance all pass.

Recommendation: use opt-in during the implementation stack, then make `cursor` part of the omitted-target default only in the final parity gate. This avoids making every existing Skillset repo fail while Cursor support is incomplete.

Provider block:

```yaml
cursor:
  projectRoot: .cursor
  userRoot: ~/.cursor
  skills:
    path: .cursor/skills
  plugins:
    path: plugins-cursor
```

Default output roots:

| Surface | Proposed default |
| --- | --- |
| standalone skills | `.cursor/skills` |
| provider project root | `.cursor` |
| plugin repository | `plugins-cursor` |
| project subagents | `.cursor/agents` |
| project MCP | `.cursor/mcp.json` |
| project hooks | `.cursor/hooks.json` |
| provider-native source islands | `.skillset/_cursor` |

Why `.cursor/skills` instead of `.agents/skills`: Cursor compatibility-loads `.agents/skills`, `.claude/skills`, and `.codex/skills`, but `.cursor/skills` is the native Cursor-owned project skill root. Using `.cursor/skills` prevents Cursor output from colliding with Codex output and makes generated provenance clearer.

## Surface Mapping

### Skills

Cursor Agent Skills are a strong exact or near-exact match for Skillset skills.

Cursor facts:

- project skills load from `.agents/skills/` and `.cursor/skills/`;
- user skills load from `~/.agents/skills/` and `~/.cursor/skills/`;
- Cursor also compatibility-loads `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, and `~/.codex/skills/`;
- each skill is a directory containing `SKILL.md`;
- optional `scripts/`, `references/`, and `assets/` directories are supported;
- nested skill directories are supported, and nested project skill directories are scoped to that subtree;
- required frontmatter fields are `name` and `description`;
- optional fields include `paths`, `disable-model-invocation`, and `metadata`;
- `globs` is still accepted as a legacy fallback, but new skills should use `paths`;
- the skill identity must match the parent folder name.

Skillset normalization:

- Render standalone Cursor skills to `.cursor/skills/<skill>/SKILL.md`.
- Render Cursor plugin skills to `plugins-cursor/plugins/<plugin>/skills/<skill>/SKILL.md`.
- Keep `SKILL.md`, `scripts/`, `references/`, and `assets/` copying aligned with existing skill render logic.
- Validate Cursor's folder-name identity requirement for Cursor-enabled skills.
- Map source `paths` to Cursor skill `paths`.
- Map a portable explicit-invocation concept to Cursor `disable-model-invocation: true` only after confirming the current `implicit_invocation` semantics. Do not invert the meaning silently.
- Keep Cursor-specific overrides under `cursor` blocks.
- Do not rely on Cursor's compatibility loading of `.agents/skills` as the main generated output. That is useful for migration and runtime smoke, not source truth.

Differences from Claude and Codex:

- Cursor supports both `.agents/skills` and `.cursor/skills`; Skillset should choose `.cursor/skills` for native output.
- Cursor requires `name` to match the parent folder; Skillset currently derives names but must make this a Cursor validation error if an override would break discovery.
- Cursor has `disable-model-invocation`, which is the inverse of many "auto invoke" phrasings. The source contract should not expose the Cursor spelling as a portable default.

### Instructions And Rules

Cursor has two relevant instruction surfaces:

- Project Rules in `.cursor/rules/**/*.mdc`.
- `AGENTS.md` files at the project root and in subdirectories.

Cursor facts:

- Project Rules are `.mdc` files under `.cursor/rules`.
- A `.md` file in `.cursor/rules` is ignored by the rules system.
- rule frontmatter uses `description`, `globs`, and `alwaysApply`;
- rules can be always-on, automatically attached by file pattern, selected by agent based on description, or manually attached by mention;
- `AGENTS.md` is a plain Markdown alternative for simple instructions;
- Cursor supports nested `AGENTS.md`, with more specific files taking precedence;
- Cursor CLI also reads root `AGENTS.md` and `CLAUDE.md` alongside `.cursor/rules`.

Skillset normalization recommendation:

- Render `.skillset/rules/**/*.md` to Cursor `.cursor/rules/**/*.mdc` by default.
- Preserve source `description` as Cursor `description`.
- Preserve source `paths` as Cursor `globs`.
- If a source rule has no `description` and no `paths`, render `alwaysApply: true`.
- If a source rule has `paths`, render `alwaysApply: false` and `globs`.
- If a source rule has `description` and no `paths`, render `alwaysApply: false` and `description`.
- Preserve source body after preprocessing.
- Do not also render Cursor `AGENTS.md` by default for the same source rule, because duplicate guidance can double-attach.
- Add an explicit Cursor provider option if we want "AGENTS.md mode" for repos that prefer plain Markdown:

```yaml
cursor:
  defaults:
    instructions:
      mode: rules # rules | agentsMd
```

This should be a Cursor-specific option, not a portable source field, because Claude and Codex do not share the same rule-type semantics.

Differences from Codex:

- Codex `AGENTS.md` concatenation loses rule metadata by design.
- Cursor `.mdc` can preserve rule intent, file scoping, and intelligent attachment.
- Cursor also understands `AGENTS.md`, so migration and import tools need to detect both without assuming they are equivalent.

Differences from Claude:

- Claude `.claude/rules/**/*.md` keeps Markdown files with optional path frontmatter.
- Cursor rules must be `.mdc` and use `globs` / `alwaysApply` behavior.
- A provider-native Cursor rule can represent manual and intelligent selection more explicitly than Claude rules.

### Project Agents And Subagents

Cursor calls custom delegated agents "subagents".

Cursor facts:

- project subagents live in `.cursor/agents/`;
- user subagents live in `~/.cursor/agents/`;
- Cursor also compatibility-loads `.claude/agents/` and `.codex/agents/`;
- `.cursor/` takes precedence over compatibility locations when names conflict;
- each subagent is a Markdown file with YAML frontmatter;
- fields include `name`, `description`, `model`, `readonly`, and `is_background`;
- `name` defaults from filename if absent;
- `model` defaults to `inherit`;
- `readonly` restricts file edits and state-changing shell commands;
- `is_background` makes the subagent run without blocking the parent;
- explicit invocation uses `/name` syntax;
- background subagents write state under `~/.cursor/subagents/`;
- cloud subagents have different MCP source behavior than local subagents.

Skillset normalization:

- Render portable project agents to `.cursor/agents/<name>.md`.
- Treat the source agent body as the Cursor subagent prompt.
- Map portable `description` directly.
- Allow `cursor.model` as a provider-specific field.
- Treat `readonly` and `is_background` as Cursor's current provider-native expression of a broader Skillset capability-intent model, not as concepts that must remain Cursor-only forever.
- Add a cross-provider design pass before implementation decides whether portable source fields should be named around intent (`capabilities.write: false`, `execution.blocking: false`) rather than provider nouns (`readonly`, `background`).
- Map portable capability intent only when a provider can enforce or honestly approximate it; otherwise fail loudly or require a provider-specific override.
- For source `skills`, either render a deterministic preface in the body or keep the field provider-specific. Cursor docs do not currently describe a `skills` field on subagents, so a top-level `skills` frontmatter render would be unsupported unless verified.
- For source `initialPrompt`, append a clearly delimited section to the body or require `cursor.initialPrompt` design before implementation. Cursor docs describe the body as the prompt, not an `initialPrompt` frontmatter field.

Differences from Codex:

- Codex project agents are TOML with `developer_instructions`.
- Cursor project agents are Markdown with YAML frontmatter.
- Cursor supports `readonly` and `is_background` directly; Codex does not expose those fields in the current Skillset adapter.

Differences from Claude:

- Claude project agents are Markdown and therefore closer structurally.
- Cursor has explicit frontmatter for `readonly` and `is_background`; Claude has adjacent permission and execution concepts, but Skillset should verify the exact enforceable mapping before claiming parity.
- Cursor compatibility-loads `.claude/agents`, but native output should still be `.cursor/agents`.

### Plugin Agents

Cursor plugins can include `agents/` as a component. This means plugin-scoped agents should be supported for Cursor, unlike Codex.

Skillset normalization:

- Treat plugin `agents/` as supported for Claude and Cursor.
- Continue failing loudly for Codex plugin `agents/`.
- If plugin agent source is currently represented only as provider-native companion files, add Cursor component copying and manifest declaration before trying to make it portable.
- If portable plugin-agent authoring becomes a goal, give it its own source contract rather than overloading project agents.

### Plugins And Marketplaces

Cursor has a first-class plugin system.

Cursor facts:

- a plugin is a directory with `.cursor-plugin/plugin.json`;
- the manifest only requires `name`;
- optional manifest fields include `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `logo`, `rules`, `agents`, `skills`, `commands`, `hooks`, and `mcpServers`;
- components are auto-discovered from default folders if manifest paths are omitted;
- default component locations include `rules/`, `skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `mcp.json`, and root `SKILL.md` for single-skill plugins;
- multi-plugin repositories use `.cursor-plugin/marketplace.json`;
- local testing uses `~/.cursor/plugins/local/<plugin>`;
- a `workspaceOpen` hook can return plugin paths to load dynamically for a workspace.

Skillset normalization:

- Render Cursor plugin bundles under `plugins-cursor/plugins/<plugin-id>/`.
- Emit `.cursor-plugin/plugin.json`.
- Emit root marketplace index at `plugins-cursor/.cursor-plugin/marketplace.json` for multi-plugin repositories.
- Prefer explicit manifest component paths for generated bundles even though Cursor can auto-discover, because Skillset locks and generated-output evidence are clearer when the manifest declares what was rendered.
- Map shared metadata to direct Cursor manifest fields, not the Codex `interface` object.
- Support `logo` as a provider-specific or shared presentation field after path-resolution rules are modeled. Cursor resolves relative logo paths to `raw.githubusercontent.com`, so local generated output cannot fully prove marketplace resolution without repo/commit context.
- Add local runtime testing via `agent --plugin-dir <path>` before claiming plugin parity.

Differences from Claude:

- Claude uses `.claude-plugin/plugin.json` plus `.claude-plugin/marketplace.json`.
- Cursor uses `.cursor-plugin/plugin.json` plus `.cursor-plugin/marketplace.json`.
- Cursor plugin manifests are more discovery-oriented and can bundle rules, skills, agents, commands, hooks, and MCP servers directly.

Differences from Codex:

- Codex current Skillset plugin output uses `.codex-plugin/plugin.json` and a Codex `interface` object.
- Cursor does not use the Codex `interface` object.
- Cursor supports plugin agents and commands; Codex plugin agent support remains unsupported in Skillset.

### MCP

Cursor supports MCP broadly.

Cursor facts:

- project MCP config lives at `.cursor/mcp.json`;
- global MCP config lives at `~/.cursor/mcp.json`;
- plugin MCP config defaults to `mcp.json` at plugin root;
- the top-level key is `mcpServers`;
- transports include `stdio`, `SSE`, and Streamable HTTP;
- Cursor supports tools, prompts, resources, roots, elicitation, and MCP Apps;
- config interpolation supports `${env:NAME}`, `${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}`, `${pathSeparator}`, and `${/}`;
- Cursor CLI uses the same MCP configuration as the editor and can manage MCP servers with `agent mcp`;
- cloud agents use team-configured MCP servers rather than local session MCP config.

Skillset normalization:

- For plugin MCP features, render Cursor `mcp.json`, not `.mcp.json`.
- Keep the source feature key `mcp` because the intent is shared.
- Validate the shape is compatible with Cursor's `mcpServers` expectation.
- Keep secrets out of generated source by encouraging env interpolation.
- Do not write `~/.cursor/mcp.json` as part of build.
- Project-level `.cursor/mcp.json` support should be a separate explicit feature or provider-native island, because the current implemented MCP feature is plugin-root oriented.

Differences from Claude and Codex:

- Existing Skillset plugin MCP output uses `.mcp.json` for Claude and Codex.
- Cursor's native plugin filename is `mcp.json`.
- Cursor supports MCP Apps, which may eventually align with Skillset app surfaces, but should not be claimed until modeled.

### Hooks

Cursor hooks are a major near-match surface.

Cursor facts:

- project hooks live at `.cursor/hooks.json`;
- user hooks live at `~/.cursor/hooks.json`;
- plugin hooks default to `hooks/hooks.json`;
- hooks communicate via JSON over stdio;
- project hooks run from project root; user hooks run from `~/.cursor/`;
- sources have precedence: Enterprise, Team, Project, User;
- config has `version: 1` and a `hooks` map;
- hook definitions support `command`, `type`, `timeout`, `loop_limit`, `failClosed`, and `matcher`;
- command hooks use exit code `2` to block;
- prompt hooks use an LLM with `$ARGUMENTS` replacement;
- hook events include agent, tab, and workspace lifecycle events;
- cloud agents run a subset of command-based hooks from `.cursor/hooks.json`.

Skillset normalization:

- Add Cursor to adaptive hook provider capabilities as its own table.
- Render plugin hook configs to `hooks/hooks.json`.
- Render project hook configs to `.cursor/hooks.json` only for project-scoped hook sources, not as a side effect of plugin output.
- Respect Cursor's project-root relative path requirement for project hook scripts, using `.cursor/hooks/<script>` paths.
- Model Cursor-only fields under `cursor` hook options.
- Treat prompt hooks as Cursor-specific until Claude/Codex parity is understood.
- Treat `workspaceOpen` plugin path loading as provider-native. It is powerful but should not become build-time activation.
- Record cloud-agent hook support in provider evidence and diagnostics, but do not assume local and cloud support are identical.

Differences from Codex:

- Codex hook support in Skillset is stricter and narrower today.
- Cursor supports many more event names and both command and prompt hooks.
- Cursor can return `followup_message` from `stop` and `subagentStop`, which creates goal-loop-like runtime behavior. This should be explicit and guarded by `loop_limit`, not hidden behind generic hooks.

Differences from Claude:

- Cursor deliberately supports some Claude Code compatibility behavior, including exit code `2` blocking and `CLAUDE_PROJECT_DIR` as an alias.
- Compatibility is not identity. Cursor has Cursor-specific event fields, environment variables, cloud support, and source precedence.

### Commands

Cursor plugins can include command files under `commands/`.

Skillset status:

- Skillset has feature docs for commands, but commands are not currently a main implemented adaptive provider surface.

Recommendation:

- Track Cursor commands as part of provider parity, but do not make them block the first Cursor provider build unless the existing Claude/Codex command story is already promoted to implemented.
- Support provider-native Cursor command pass-through through `_cursor/commands/` or plugin companion files first.
- Design portable commands separately once Claude, Cursor, and any Codex equivalent are compared.

### Tool Policy And Permissions

Cursor exposes several policy surfaces:

- CLI run modes and `--force` / `--auto-review`;
- MCP approval and enterprise MCP allowlists;
- hooks with allow/deny/ask outcomes;
- subagent `readonly`;
- sandbox mode;
- browser and MCP allow/block controls.

Recommendation:

- Promote this from a Cursor-only concern into a provider capability-intent design problem. This is close to Skillset's ultimate purpose: author a stable source intent once, then render the strongest honest provider-native form for Claude, Codex, Cursor, and future providers.
- Start with a small portable vocabulary for agent/tool authority rather than a provider-name mirror. Candidate axes include file writes, state-changing shell commands, network/MCP access, browser access, approval posture, blocking/background execution, and sandbox/trust requirements.
- Make the portable fields describe intent and constraints, not implementation mechanics. For example, a source unit should be able to say "this delegated agent is read-only" without knowing that Cursor calls the field `readonly`.
- Require each provider adapter to declare whether it can enforce, approximate with a documented weaker guarantee, or reject each capability axis.
- Do not map capability intent to prose-only rules unless the behavior is advisory by design and the docs/tests make that limitation visible.
- Use Cursor hooks and MCP/server policy only when a provider-specific implementation exists, but let the shared capability model describe why that implementation is needed.
- Add diagnostics that name the source intent, the provider's capability, and the degradation path. Silent downgrades would defeat the point of normalizing this layer.

### Runtime Tester

Cursor CLI can support a Skillset runtime tester lane.

Proposed command shape for read-only smoke:

```bash
agent -p --output-format json --trust --workspace <isolated-root> "<prompt>"
```

Proposed command shape when writes are intentionally part of the runtime test:

```bash
agent -p --force --output-format json --trust --workspace <isolated-root> "<prompt>"
```

Provider tester additions:

- accept `target: cursor`;
- use `SKILLSET_RUNTIME_TESTER_CURSOR_BIN` with default `agent`;
- support `--plugin-dir` for generated Cursor plugin directories;
- write retained artifacts next to Claude/Codex retained runs;
- capture final result from JSON output;
- keep Cursor auth/API-key failures distinct from generated-output failures;
- document that `CURSOR_API_KEY` or local login may be required.

Do not use `--force` for the default smoke. Cursor docs say print mode without `--force` proposes changes but does not apply them. That is safer for ordinary provider activation tests.

## Provider-Native Islands

Add `_cursor` as a provider-native island directory:

```text
.skillset/_cursor/
.skillset/plugins/<plugin>/_cursor/
```

Allowed initial uses:

- `.cursor` project config files that have no adaptive source yet;
- Cursor plugin companion files such as `commands/`;
- Cursor-specific rule files only when they do not collide with adaptive generated rules;
- experimental surfaces that should be visible as provider-native.

Rules:

- `_cursor` files must remain inside the generated Cursor destination.
- Provider-native islands must participate in locks, safety checks, and explain output.
- Islands must not bypass source validation for known adaptive surfaces.
- If an island collides with adaptive generated output, fail loudly.

## Provider Evidence And Drift

Cursor provider support should join the provider-format evidence system.

Add Cursor snapshots or manual overlays for:

- skills `SKILL.md` fields and discovery paths;
- rules `.mdc` frontmatter and `AGENTS.md` behavior;
- subagent file format and fields;
- plugin manifest and marketplace manifest;
- component discovery defaults;
- hooks config and event schema;
- MCP config;
- CLI headless/runtime invocation.

Maintenance commands should report Cursor in `skillset providers check`, `diff`, and `update --yes`. Ordinary builds must remain offline.

## Schema And Contract Changes

Required schema package changes:

- add `cursor` to `TARGET_NAMES`;
- add `cursor` to workspace config keys;
- add `cursor` provider override blocks to skill, agent, instruction, and hook contracts;
- add Cursor provider defaults under `defaults.cursor.<surface>`;
- update generated JSON Schemas and examples;
- update Workbench schema consumption;
- add package Changeset because schema package changes are package-facing.

Important rollout constraint:

- Adding `cursor` to schema as a recognized target before render support exists must produce clear diagnostics. Do not allow `compile.targets: [cursor]` to parse and then silently render nothing.

## Implementation Sequence

1. Research, ADR, and provider evidence baseline
   - Record the Cursor source facts in docs and provider-format snapshots.
   - Decide whether Cursor defaults to opt-in until final parity.
   - Define the exact first-supported surface set.

2. Provider identity and schema plumbing
   - Add `cursor` to target enums and type unions.
   - Add root `cursor` blocks and defaults.
   - Add output config for Cursor skills/plugins/project root.
   - Update generated schemas and examples.
   - Keep `compile.targets: [cursor]` fail-loud until at least one renderer is implemented.

3. Render infrastructure and output safety
   - Add `plugins-cursor`, `.cursor/skills`, `.cursor` roots.
   - Add `_cursor` provider-native islands.
   - Add lock root support for Cursor.
   - Update deterministic projection, build safety, version audit, explain/list/diff, and fixture utilities.

4. Skills parity
   - Render standalone and plugin skills to Cursor native locations.
   - Validate Cursor skill name/folder rules.
   - Preserve scripts, references, assets, resources, metadata, versions, and generated fields.
   - Add tests and golden fixtures.

5. Instructions/rules parity
   - Implement `.cursor/rules/**/*.mdc` rendering.
   - Map `description`, `paths`, and always-apply behavior.
   - Add optional Cursor `AGENTS.md` mode only if needed.
   - Add collision and duplicate-context protections.

6. Project subagents
   - Render project agents to `.cursor/agents/*.md`.
   - Add Cursor-specific `model`.
   - Map portable capability intent to Cursor `readonly` and `is_background` where SET-254 proves the mapping.
   - Decide and implement `initialPrompt` handling.
   - Add fixture coverage for compatibility and provider-specific fields.

7. Plugin and marketplace parity
   - Render `.cursor-plugin/plugin.json`.
   - Render `.cursor-plugin/marketplace.json`.
   - Wire components for skills, rules, agents, hooks, MCP, commands where supported.
   - Add local plugin layout tests and provider-format snapshots.

8. MCP and hooks parity
   - Render plugin `mcp.json`.
   - Add Cursor hook capabilities and event validation.
   - Render plugin hooks and project hooks where source ownership is clear.
   - Add diagnostics for cloud-only or local-only differences.

9. Runtime tester and live smoke
   - Add Cursor runtime tester target.
   - Support `agent --plugin-dir`.
   - Retain Cursor run artifacts.
   - Run a real local CLI smoke and record auth/runtime findings.

10. Docs, import, Workbench, and conformance
    - Update `docs/target-surfaces.md`, feature docs, generated schema references, README, quickstart, examples, and self-hosted Skillset skills.
    - Extend import/adopt helpers for Cursor native files.
    - Add conformance fixtures and external fixture coverage.
    - Run full `bun run check`, `bun run skillset:ci`, `bun run conformance:fast`, and provider maintenance checks.

## Definition Of Done For Cursor Parity

Cursor provider parity is done when:

- `compile.targets: [cursor]` builds deterministic Cursor-native output for the implemented surfaces.
- omitted `compile.targets` either intentionally includes Cursor or a documented rollout gate says why it remains opt-in.
- generated Cursor standalone skills, plugin skills, rules, project subagents, plugins, MCP, hooks, locks, and provider-native islands are covered by fixtures.
- unsupported Cursor surfaces fail with specific diagnostics.
- provider-format evidence includes Cursor source URLs, fetched timestamps, hashes or manual overlays, and maintenance command output.
- Workbench and schema artifacts agree with compiler validation.
- runtime tester can run a local Cursor read-only smoke and distinguish auth failure from adapter failure.
- docs describe Cursor differences rather than flattening them into Claude/Codex terminology.
- Linear issues and dependencies reflect the implementation sequence.

## Not Done

The following states are useful progress but not parity:

- Cursor loads generated `.agents/skills` from Codex output by compatibility alone.
- `compile.targets` accepts `cursor` but only emits partial output without provider diagnostics.
- Cursor rules are rendered as unscoped prose in `AGENTS.md` while `.cursor/rules` semantics remain unmodeled.
- Cursor plugins reuse Codex `.codex-plugin` manifests or `interface` metadata.
- MCP output keeps `.mcp.json` for Cursor plugin bundles.
- hooks are copied through without event, working-directory, or cloud-support validation.
- runtime smoke passes only because Cursor compatibility-loads Claude/Codex output.

## Open Decisions

- Should Cursor join the omitted-target default in the same PR that introduces the target, or only after the final parity gate?
- Should source instructions default to Cursor `.cursor/rules` or offer a repo-level `cursor.defaults.instructions.mode` from the start?
- Should portable project-agent `skills` render as body preface for Cursor subagents, or remain unsupported until Cursor documents a frontmatter field?
- How should source `implicit_invocation` map to Cursor `disable-model-invocation` without confusing the polarity?
- Should Cursor commands be included in the first parity stack, or tracked as a provider-native follow-up?
- How much of Cursor cloud-agent behavior belongs in Skillset v1 provider parity versus future runtime activation proof?

## Recommended Linear Project Shape

Project: `Skillset Cursor provider parity`

Milestones:

1. Evidence and provider contract
2. Core provider plumbing
3. Cursor-native surface renderers
4. Runtime, import, and conformance
5. Docs and parity gate

Issue sequence:

1. Research Cursor provider evidence and write the Cursor adapter ADR.
2. Design portable agent capability and permission intent across Claude, Codex, and Cursor.
3. Add Cursor target schema, config, defaults, and generated schema artifacts.
4. Add Cursor output roots, provider-native islands, locks, and build safety.
5. Render Cursor standalone and plugin skills.
6. Render Cursor project rules and decide `AGENTS.md` mode.
7. Render Cursor project subagents and provider-specific fields.
8. Render Cursor plugin and marketplace manifests with component discovery.
9. Add Cursor MCP and hooks support.
10. Add Cursor provider-format maintenance snapshots and drift reporting.
11. Add Cursor runtime tester support and real CLI smoke.
12. Extend import/adopt, Workbench, docs, examples, and generated Skillset guidance.
13. Run full parity conformance and enable Cursor as a default provider if approved.

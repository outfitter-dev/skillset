# Adaptive Hooks

Feature id: `adaptive-hooks`

Related pages: [Hooks](hooks.md), [Hook Guardrails](hook-guardrails.md), [Feature Registry](feature-registry.md), [Render Results](render-results.md)

Adaptive hooks are the planned portable authoring layer above target-native hook files. The goal is to let authors define hook behavior once, attach it to the source units where it belongs, and have Skillset render only the provider/destination combinations that preserve the intended scope and runtime behavior.

The current implemented hook feature remains native aggregate pass-through through `hooks/hooks.json`. This page records the next contract shape so schema, registry, fixture, and Linear work stay aligned.

## Boundaries

Adaptive hooks are generated definitions only. Skillset must not install hooks, trust plugins, enable project runtime config, mutate user-level Claude/Codex settings, or imply that generated hooks are active.

Adaptive hooks are separate from workflow hook guardrails. Guardrails such as `skillset hooks print` and `skillset hooks run stop` help local Git hooks or reviewed agent-runtime snippets call Skillset checks. Adaptive hooks compile source-authored runtime hook definitions into provider-native hook surfaces.

The first portable slice should be command-first. Claude's hook model is broader, and Skillset should parse Claude-complete hook source, but the first shared render should normalize only behavior that can be represented faithfully for the enabled provider/destination.

## Source Model

Adaptive hook definitions should use split-file authoring so a repo is not forced into one large aggregate hook file:

| Source | Meaning |
| --- | --- |
| `hooks/<name>.json` | Flat adaptive hook unit. |
| `hooks/<name>/hook.json` | Directory adaptive hook unit with hook-local sidecars. |
| `hooks/<name>/<name>.json` | Directory adaptive hook unit with a manifest named after the directory. |
| `hooks/hooks.json` | Reserved native aggregate escape hatch, not an adaptive hook unit. |

Directory hook units must resolve to the directory name. If both `hook.json` and `<name>.json` exist in the same hook directory, Skillset should fail with an ambiguous manifest diagnostic.

Native aggregate mode and adaptive mode should not merge for the same generated destination in v1. If `hooks/hooks.json` and adaptive hook units would both write a provider plugin `hooks/hooks.json`, fail clearly and ask the author to choose one source model.

## Scripts

Adaptive hook `run.script` references have two source-backed forms:

| Reference | Source proof |
| --- | --- |
| `./check.js` | Hook-local script beside a directory hook unit such as `hooks/<name>/hook.json` or `hooks/<name>/<name>.json`. |
| `{{scripts.dir}}/check.js` | Shared script under the owner source directory's `scripts/` folder. Root hooks use `<source-root>/scripts/`; plugin hooks use `<plugin>/scripts/`; skill-local hooks use the skill directory's `scripts/`; project-agent-local hooks use the sibling agent directory's `scripts/`. |

Flat hook units such as `hooks/<name>.json` cannot use `./...` hook-local scripts because they do not own a private sidecar directory. Use a directory hook unit for colocated sidecars or `{{scripts.dir}}/...` for owner-level shared scripts.

The current compiler validates that these script references resolve to source files and records the source facts for later rendering. Provider-native command rewriting and output path proof land with adaptive rendering.

## Attachments

Hook definitions should be reusable. Source units attach named hooks through event-keyed frontmatter or config:

```yaml
hooks:
  PreToolUse:
    - source-change-guard
  Stop:
    - hook: shell-policy
      match:
        tool: [Bash]
      status: Checking shell changes
      providers: [claude, codex]
  auto:
    - session-metadata
```

`hooks.auto` expands from the hook definition's declared events. Attachment-level matchers can narrow a definition but cannot broaden its declared event, matcher, handler, or provider support.

Resolution is nearest-first for named hook references:

1. Skill-local hooks.
2. Agent-local hooks.
3. Plugin-local hooks.
4. Repo/root hooks.

Nearest-first resolution only chooses named source definitions. It does not override provider runtime behavior. Claude and Codex may run multiple matching hooks from different runtime layers, and Skillset should not claim serial short-circuit behavior unless a provider documents it.

## Provider Registry

The provider/destination capability registry should own hook support decisions at event granularity. A target-wide "hooks supported" flag is too coarse.

Each registry row for a hook destination should capture:

| Field | Purpose |
| --- | --- |
| Provider and destination | For example Claude plugin hooks, Claude skill frontmatter, Codex plugin hooks, or Codex project hooks. |
| Event support | Provider-native event names, aliases, input/output shape evidence, and provider-specific semantics. |
| Matcher behavior | Whether the event supports matchers, what the matcher matches, and whether ignored matchers are unsupported or degraded. |
| Handler support | Command/http/mcp/prompt/agent support, async support, and status-message support. |
| Scope support | Whether plugin, skill-local, agent-local, project/root, or user scope can preserve the attachment's runtime boundary. |
| Runtime path proof | Whether hook-local `./...`, `{{scripts.dir}}`, plugin roots, and shared scripts can resolve to files that exist in the rendered destination. |
| Evidence | Provider docs, checked-in provider snapshots, schema snapshots, manual overlays, fixtures, and tests. |

Provider-native PascalCase event names are the primary input. Dotted Skillset aliases may exist only when they normalize one-to-one to provider-backed registry entries.

## Provider Facts

Provider docs checked: 2026-06-25.

Claude references:

- [Claude hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude hooks guide](https://code.claude.com/docs/en/hooks-guide)

Claude has the broader reference surface: many lifecycle events, command/http/mcp_tool/prompt/agent handlers, async hooks, handler-level `if`, event-specific matchers, and rich event output behavior. Skillset should preserve Claude-only hooks for Claude destinations rather than squeezing them into Codex output.

Codex references:

- [Codex hooks reference](https://developers.openai.com/codex/hooks)
- [Codex config reference](https://developers.openai.com/codex/config-reference)
- [Codex advanced config](https://developers.openai.com/codex/config-advanced)
- [Codex plugin build docs](https://developers.openai.com/codex/plugins/build)

Codex currently documents `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SubagentStart`, `SubagentStop`, `UserPromptSubmit`, and `Stop`. Codex executes synchronous `command` handlers today; `prompt`, `agent`, and async command hooks are parsed but skipped, so Skillset should treat them as incompatible for Codex render until runtime behavior changes.

Codex matcher behavior is event-specific. Tool events match tool names and aliases, compaction hooks match `manual` or `auto`, session start matches startup reasons, subagent hooks match agent type, and `UserPromptSubmit` plus `Stop` ignore matcher. Ignored matchers should be visible as unsupported, degraded, or skipped behavior rather than silently accepted.

Codex plugin hooks default to `hooks/hooks.json`. Plugin hook commands can use `PLUGIN_ROOT` and `PLUGIN_DATA`; Codex also exposes Claude-compatible `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` for plugin hooks. This replaces the older uncertainty about whether Codex had a documented plugin-root variable.

Codex upstream generated schemas live under `openai/codex` at `codex-rs/hooks/schema/generated/*.schema.json`. SET-117 should use those schema snapshots as evidence rather than relying only on hand-maintained event lists.

## Fixture Plan

The first fixture set should prove supported, transformed, degraded, unsupported, and collision cases:

| Fixture | Expected proof |
| --- | --- |
| Intersection command hook | `PreToolUse` Bash destructive-command guard renders to Claude and Codex. |
| Matcher normalization | `PostToolUse` edit/apply_patch hook renders provider-specific matcher forms. |
| Ignored Codex matcher | `Stop` or `UserPromptSubmit` matcher is reported instead of silently rendered as meaningful. |
| Claude-only event | `Notification`, `ConfigChange`, `CwdChanged`, or `FileChanged` stays Claude-supported and Codex-unsupported. |
| Handler divergence | Claude `http`, `prompt`, or `agent` handler remains Claude-native and Codex-incompatible. |
| Plugin path proof | Codex hook uses `PLUGIN_ROOT`; Claude hook uses `CLAUDE_PLUGIN_ROOT`; generated commands point at existing files. |
| Native aggregate collision | `hooks/hooks.json` plus adaptive hook units targeting the same output fails clearly. |
| Directory hook unit | `hooks/<name>/hook.json` can reference hook-local scripts safely. |
| `hooks.auto` | Declared events expand through provider/destination registry support. |

## Issue Split

The implementation stack should stay small enough to review:

- SET-117 defines the adaptive hook unit schema and provider/destination capability registry. It should seed registry data from official provider docs plus Codex generated schemas, then add fixtures for capability proof.
- SET-118 adds event-keyed attachments, `hooks.auto`, provider scoping, and nearest-first resolution.
- SET-119 renders adaptive hooks to provider-native outputs and component frontmatter, using structured render results for transformed, degraded, skipped, and unsupported destinations.
- SET-127 handles hook-adjacent scripts, `bin`, and stable runtime variables only after SET-117 has encoded the path-proof requirements.

The first merged slice should make provider capability facts inspectable and testable before rendering new hook output.

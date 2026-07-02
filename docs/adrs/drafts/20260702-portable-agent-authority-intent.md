---
slug: portable-agent-authority-intent
title: Portable Agent Authority Intent
status: draft
created: 2026-07-02
updated: 2026-07-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, feature-reference-and-schema-registry, agent-source-model, lowering-outcomes-and-loss-ledger, reviewed-settings-suggestions, cursor-is-a-first-class-provider]
---

# ADR: Portable Agent Authority Intent

## Context

Cursor made a latent problem visible. Its project subagents expose simple
frontmatter fields for `readonly` and `is_background`. Claude and Codex can often
produce the same practical result, but the route is different:

- Claude project subagents support frontmatter such as `tools`,
  `disallowedTools`, `permissionMode`, `mcpServers`, `hooks`, `background`, and
  `isolation`.
- Codex custom agents are TOML config layers. They can carry normal session
  settings such as `sandbox_mode`, `approval_policy`, named permission profiles,
  MCP server config, web search, and feature toggles.
- Cursor project subagents keep the definition smaller: `readonly` constrains
  file edits and state-changing shell commands, while `is_background` controls
  whether the parent blocks.

If Skillset copies provider field names upward into adaptive source, the source
contract becomes a bag of target knobs. If it ignores the provider differences,
it will claim portability where only one provider can enforce the behavior. The
right question is not "what field name does each provider use?" It is "what
author intent should the generated provider setup accomplish, and how honestly
can each provider enforce that intent?"

## Decision

Skillset will model project-agent authority as portable intent plus
provider-declared realizations. The source contract should say what the author
wants the agent to be allowed to do; provider adapters decide whether that intent
can be rendered natively, through provider settings, through an approximation, or
not at all.

The first portable source fields should be deliberately small:

```yaml
---
name: verifier
description: Verifies completed work without modifying the workspace.
authority:
  write: false
execution:
  background: true
---
```

`authority.write: false` means the agent is intended to inspect, analyze, and
report without changing source files or running state-changing shell commands.
It is a composite author intent, not an alias for Cursor `readonly`, Claude
`permissionMode`, or Codex `sandbox_mode`.

`execution.background: true` means the agent is intended to run without blocking
the parent conversation when the provider has a definition-level way to express
that. Providers that only decide background behavior at invocation time must not
pretend the project-agent file enforces it.

### Provider Mapping

| Intent | Claude | Codex | Cursor | Skillset result |
| --- | --- | --- | --- | --- |
| Agent should not write or run state-changing commands | Render `permissionMode: plan` or a strict `tools`/`disallowedTools` set when the requested surface is compatible. Richer command restrictions require hooks or permission settings. Parent permission modes can override some agent-local intent. | Render `sandbox_mode = "read-only"` for custom agents. Richer filesystem/network policy can use named permission profiles or project config when trusted. | Render `readonly: true`. This is the native Cursor field for no file edits and no state-changing shell commands. | Native or enforceable where exact; degraded when shell, MCP, or parent-session inheritance can still widen behavior. |
| Agent may write in the workspace | Omit read-only restriction or render `permissionMode: acceptEdits` only when the author explicitly wants that behavior. | Use inherited/default config or `sandbox_mode = "workspace-write"` when explicitly requested. | Omit `readonly` or set `readonly: false`. | Portable, but defaults should stay conservative and provider-local overrides remain allowed. |
| Background execution | Render Claude `background: true`. | No static project-agent field currently proves a per-agent background default; Codex orchestration is prompt/runtime driven. | Render `is_background: true`. | Native for Claude and Cursor; unsupported or invocation-only for Codex until provider evidence changes. |
| Shell policy beyond read-only/write intent | Use `tools`, `disallowedTools`, permission rules, or hooks. | Use sandbox, approval policy, command rules, or permission profiles. | Cursor subagent docs do not expose a per-agent shell allowlist beyond `readonly`. | Registry aspect first; source field later only for an enforceable common intent. |
| Network access | Use WebFetch/WebSearch tool availability, permission rules, or sandbox network settings. | Use `sandbox_workspace_write.network_access`, network proxy/domain policy, `web_search`, or permission profiles. | No proven per-agent network policy in project-agent frontmatter; cloud agents use team cloud configuration. | Provider settings suggestion or target-native override, not a portable agent field yet. |
| MCP access | Use `mcpServers`, tool allow/deny patterns, and managed MCP restrictions. | Use `mcp_servers` config and per-server/per-tool enablement or approval modes. | Subagents inherit parent MCP tools locally; cloud subagents use team cloud configuration. | Portable `mcp` intent needs separate design because "inherit", "none", and "server list" mean different things per provider. |
| Browser capability | Usually an MCP/tool choice, not a universal agent field. | Usually MCP/app/tool configuration plus sandbox/network policy. | Built-in browser subagent and MCP/cloud behavior exist, but custom frontmatter is not a browser policy surface. | Treat as a capability aspect backed by provider evidence, not a first source key. |
| Approval posture | `permissionMode` can be rendered for project/user subagents; plugin subagents ignore it. | `approval_policy` can be rendered in a custom agent config layer. | Cursor project-agent frontmatter does not expose an equivalent approval policy. | Provider-native or settings suggestion only until a common author intent is proven. |
| Isolation | Claude supports `isolation: worktree`. | Codex isolation is mostly sandbox/config/workspace-root based; custom agents can carry those config choices. | Cloud subagents run on a VM/branch; local project-agent frontmatter does not expose a generic worktree isolation field. | Separate from `authority.write`; do not collapse isolation into read-only. |

### Registry Shape

The provider registry should describe each aspect independently from feature
support. A target support row for project agents says the provider can render a
project agent. An authority-aspect row says whether that provider can enforce a
specific intent for that project agent.

Each provider/aspect declaration should record:

| Field | Meaning |
| --- | --- |
| `aspect` | Stable Skillset concept, for example `authority.write` or `execution.background`. |
| `providerField` | Native field or config path, when one exists. |
| `surface` | Where enforcement lives: agent definition, project config, user config, invocation, managed policy, or nowhere. |
| `realization` | `native`, `settings-required`, `approximate`, `advisory`, or `unsupported`. |
| `diagnostic` | Message to emit when source intent cannot be enforced exactly. |
| `evidence` | Provider docs, local snapshots, tests, or runtime proof backing the declaration. |

Renderers must consume this registry rather than hard-coding one-off mappings.
That keeps future provider packages viable: a new provider should be able to
declare how it realizes `authority.write` without patching every call site that
knows about Cursor `readonly` or Codex `sandbox_mode`.

### Settings Stay Separate

Some correct renderings require provider settings rather than agent files.
Skillset may propose those as reviewed settings suggestions, but `skillset build`
must not silently mutate user, local, managed, or trusted-project provider
configuration. This follows the existing settings-suggestion boundary:
generated provider output defines artifacts; activation and authority-changing
settings remain reviewable setup.

For example, an agent source that asks for `authority.write: false` and
`network: none` can render a Codex `sandbox_mode = "read-only"` if that lives in
the custom agent file. A broader Codex permission profile or Claude project
settings edit should be presented as a suggestion or target-native source, not
invented as a side effect of build.

### Diagnostics

Lossy or partial authority rendering must be visible. Skillset should say
exactly which part of the intent was realized and where the remaining risk lives:

- "rendered Cursor `readonly: true` for `authority.write: false`";
- "rendered Claude `background: true` for `execution.background: true`";
- "Codex has no project-agent definition field for background execution; this is
  invocation-time behavior";
- "Claude tool allowlist removes Write/Edit, but Bash can still change state
  unless paired with hooks or permission settings";
- "Cursor has no proven per-agent MCP allowlist; inherited MCP tools may remain
  available."

## Consequences

### Positive

- Adaptive agent source can express the outcome authors care about without
  leaking provider names into every shared field.
- Cursor `readonly` and `is_background` become part of a proven mapping instead
  of staying isolated provider quirks.
- Codex can use its stronger config-layer model where that is actually the best
  provider-native way to achieve the intent.
- Claude can use its richer subagent fields and permission model without forcing
  those names onto Cursor or Codex.
- Registry-backed aspect declarations give future provider packages a place to
  add compatibility evidence without editing unrelated renderers.

### Tradeoffs

- A small portable vocabulary means some provider knobs remain provider-native
  until they prove a common intent. That is a feature, not a gap.
- Some mappings are exact only for project agents, not plugin agents or user/global
  config. Scope must remain part of every support claim.
- Diagnostics will be more verbose when source intent crosses a provider boundary
  that cannot enforce it exactly.

### What This Does NOT Decide

- It does not add every possible authority field to the source schema. Network,
  MCP, browser, approval, shell allowlists, and sandbox profiles need registry
  facts and source examples before becoming public fields.
- It does not let build write provider settings. Reviewed settings suggestions
  remain the path for synthesized project/user/runtime config changes.
- It does not make read-only identical to isolation. Worktrees, cloud branches,
  sandbox roots, and "no writes" are separate concepts even when they often appear
  together in workflows.
- It does not require all providers to support plugin agents. The existing
  provider truth around plugin-agent destinations still applies.

## References

- [Tenets](../../tenets.md) - source-first, provider-native, fail-loud design principles.
- [Feature Reference and Schema Registry](20260604-feature-reference-and-schema-registry.md) - registry-backed feature and capability evidence.
- [Agent / Subagent Source Model](20260604-agent-source-model.md) - project-agent and plugin-agent boundaries.
- [Lowering Outcomes and Loss Ledger](20260614-lowering-outcomes-and-loss-ledger.md) - visible degraded, lossy, and unsupported render results.
- [Reviewed Settings Suggestions](20260604-reviewed-settings-suggestions.md) - authority-changing settings are reviewable plans, not build side effects.
- [Cursor Is a First-Class Provider](20260702-cursor-is-a-first-class-provider.md) - Cursor-specific provider boundary this ADR specializes.
- [Claude subagents docs](https://code.claude.com/docs/en/sub-agents) - subagent fields, tools, permission modes, MCP, hooks, background, and isolation, checked 2026-07-02.
- [Codex subagents docs](https://developers.openai.com/codex/subagents) - custom agents as config layers and inherited sandbox/approval behavior, checked 2026-07-02.
- [Codex approvals and security docs](https://developers.openai.com/codex/agent-approvals-security) - sandbox, approval, network, and permission controls, checked 2026-07-02.
- [Cursor subagents docs](https://cursor.com/docs/subagents) - `readonly`, `is_background`, cloud subagents, inheritance, and custom-agent locations, checked 2026-07-02.

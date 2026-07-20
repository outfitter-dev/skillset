---
slug: portable-agent-authority-intent
title: Portable Tools Policy and Agent Authority
status: draft
created: 2026-07-02
updated: 2026-07-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, feature-reference-and-schema-registry, agent-source-model, lowering-outcomes-and-loss-ledger, reviewed-settings-suggestions, 2]
---

# ADR: Portable Tools Policy and Agent Authority

## Context

Skillset's current portable tool-policy source shape is `tool_intent`. That
name was chosen to avoid pretending provider tool preapproval was a portable
security sandbox, but the result now reads like compiler metadata rather than
author-facing source.

The provider landscape also changed underneath the original split:

- Claude skills support `allowed-tools` / `disallowed-tools`; Claude subagents
  expose richer tool, permission, MCP, hook, and execution controls.
- Codex supports Agent Skills, and the Agent Skills spec includes experimental
  `allowed-tools`. Codex custom agents are TOML config layers and can include
  normal Codex config such as `sandbox_mode`, `mcp_servers`, and
  `skills.config`.
- Cursor project agents expose fields such as `readonly`; Cursor hooks expose
  tool-use interception such as `preToolUse`.

Tool authority therefore spans multiple provider surfaces: skill frontmatter,
subagent/custom-agent files, hooks, runtime permissions/config, MCP/app tool
availability, and reviewed settings suggestions. Splitting author intent into
separate `authority`, `tools`, and provider-specific knobs makes users learn
Skillset's internals instead of describing the operating envelope they want.

## Decision

Replace `tool_intent` with a first-class `tools` block. The block has three
layers, each with one job:

1. **Macro layer:** named bundles such as `readonly` expand deterministically
   into portable base keys. Macros are sugar only; the registry never sees them.
2. **Portable base layer:** lowercase capability keys such as `read`, `search`,
   `write`, `shell`, and `mcp`. This is the only portable vocabulary the
   registry and renderers know.
3. **Provider layer:** per-provider blocks such as `tools.claude`,
   `tools.codex`, and `tools.cursor` hold portable overrides plus native
   `allow` / `deny` rule strings. Native syntax is legal only in provider
   blocks.

There is no `tools.intent` namespace, no global native `tools.allow` /
`tools.deny`, no dot-selector mini-language, and no wildcard-server MCP grants
in the portable layer.

Common source:

```yaml
tools:
  read: true
  search: true
  write: false
  shell:
    - git status
    - git diff *
  mcp:
    github: [get_*, list_*]
    linear: false
```

One-word source:

```yaml
tools: readonly
```

Provider-specific source:

```yaml
tools:
  read: true
  write: false

  claude:
    read: false
    deny:
      - Bash(rm *)
```

The namespace rule should be teachable in one sentence: lowercase keys are
portable Skillset syntax; `allow` / `deny` under a provider name hold that
provider's native rule strings verbatim; nothing native appears anywhere else.

## Value Shapes

Portable keys draw from a small shared set of value shapes:

```text
true | false | list of glob strings | map of selector -> these shapes
```

Each key declares the subset it supports. A list is sugar for a map where every
entry is `true`. In the first implementation, `read`, `search`, and `write` are
boolean only.

## Semantics

The `tools` block is **open-world**. It describes deltas from provider defaults,
not a closed capability envelope.

- **Unset** emits nothing; the provider default applies.
- **`true`** lowers to whatever grant or preapproval mechanism the surface has.
- **`false`** lowers to whatever constraint mechanism the surface has.
- **No surface for the intent** emits a diagnostic; never silently pretend
  portability.

Never synthesize a closed allowlist from open-world source. For example, Claude
subagent `tools` is a closed list: listing `Read` would deny everything
unlisted. Lowering `read: true` into that field would be stricter than the
author said. Grants lower to grants; denials lower to denials. If a surface only
offers a closed list, that realization is approximate or degraded and must be
diagnosed.

## Precedence and Conflicts

1. Provider overrides beat the base. Effective portable policy per provider is
   the base portable keys deep-merged with `tools.<provider>` portable keys.
2. Deny beats allow at any single layer.

Native overlays apply after portable resolution. The rule is contradiction, not
direction:

- Native `deny` is always valid.
- Native `allow` is valid when the effective portable policy is silent or
  granting for that capability. It is provider-native preapproval, not a
  portable authority expansion.
- Native `allow` that contradicts an effective portable `false` for the same
  capability is a build error. Broadening a portable constraint belongs in a
  provider portable override, where `skillset explain` can show provenance.

Implementation requires a small native-rule classifier so obvious
contradictions are caught:

| Native rule | Capability family |
| --- | --- |
| `Bash(...)` | `shell` |
| `mcp__...` | `mcp` |
| `Write`, `Edit` | `write` |
| `Read` | `read` |
| `Grep`, `Glob` | `search` |

Unrecognized provider-native rules remain valid but unclassified and must be
shown with native-source provenance.

## Macro Layer

Macros are pure sugar. They expand to exactly one canonical base-key object.
The registry has rows for base keys only, never for macros.

The first implementation ships one macro:

```yaml
tools: readonly
```

It expands to:

```yaml
tools:
  read: true
  search: true
  write: false
```

There is no macro-plus-overrides syntax in the first implementation. If an
author wants to customize `readonly`, they write the three-line expansion.

The composite "no writes, no state-changing shell" meaning is carried by
`write: false`. Codex custom agents can realize that as
`sandbox_mode = "read-only"` where appropriate. Cursor project agents can
realize it as `readonly: true`. Claude gets the strongest honest combination of
tool denials plus diagnostics for residual Bash/MCP mutation risk when the
surface cannot enforce the envelope.

## Portable Keys

The first implementation supports this fenced vocabulary:

| Key | Value shape | Notes |
| --- | --- | --- |
| `read` | `true` / `false` | Boolean only; path scoping is deferred. |
| `search` | `true` / `false` | Boolean only; path scoping is deferred. |
| `write` | `true` / `false` | Composite intent including file writes and state-changing shell. |
| `shell` | `true` / `false` / flat list of pattern strings | Named `shell`, not `bash`; provider renderers lower to `Bash(...)`, `Shell`, sandbox rules, hooks, or diagnostics. |
| `mcp` | `false` / map of literal server -> `true`, `false`, or glob list | No wildcard server keys. |
| `<provider>` | portable overrides plus native `allow` / `deny` strings | `claude`, `codex`, and `cursor` initially. |

Candidate keys such as `edit`, `web_fetch`, and `web_search` must pass two
tests before they join the portable vocabulary:

1. No portable key is merely a renamed provider field.
2. Every portable key has a sensible realization on at least two providers.

Higher-level simplification happens through macros, not new abstract base keys.

## Shell

The canonical portable shell form is a flat list of patterns:

```yaml
tools:
  shell:
    - git status
    - git diff *
    - gh pr view *
```

Claude lowering renders these as `Bash(git status)`, `Bash(git diff *)`, and
`Bash(gh pr view *)`. Skillset does not introduce a shell family map such as
`git: [status]`; shell patterns are one-dimensional strings, while MCP is
genuinely two-dimensional.

`write: false` plus shell entries is valid composition:

```yaml
tools:
  write: false
  shell:
    - git status
    - git diff *
```

`write: false` is the enforcement envelope. Explicit shell entries are
invocation grants within it. Where the provider enforces the envelope, such as
Codex sandboxing or Cursor `readonly`, a mutating command is blocked at runtime
by the provider. Where the provider cannot enforce it, such as Claude tool
preapproval alone, Skillset emits the residual-risk diagnostic. Skillset does
not statically classify shell patterns as mutating or non-mutating.

## MCP

Portable MCP policy is a server-keyed map. The server key is always literal; the
value covers the tool scope:

```yaml
tools:
  mcp:
    github: true
    linear: [get_*, list_*]
    slack: false
```

`mcp: false` denies all MCP.

Provider facts backing this decision:

- Claude allow rules accept tool globs only after a literal
  `mcp__<server>__` prefix. The server segment must be glob-free.
- Claude deny and ask rules accept full tool-name globs such as `mcp__*`.
- Claude deny beats allow.
- Claude skill `allowed-tools` is preapproval only. `disallowed-tools` removes
  tools from the available pool. Claude subagent `tools` is a closed allowlist.
- Agent Skills `allowed-tools` is experimental for Codex until proven by
  runtime evidence.

Lowering examples:

| Source | Claude | Notes |
| --- | --- | --- |
| `github: true` | `mcp__github` | Whole-server allow. Both `mcp__github` and `mcp__github__*` are valid; Skillset emits the shorter form. |
| `github: [get_*, list_*]` | `mcp__github__get_*`, `mcp__github__list_*` | Literal server plus tool globs. |
| `linear: false` | `disallowed-tools: mcp__linear` | Whole-server denial. |
| `mcp: false` | `disallowed-tools: mcp__*` | The only portable two-dimensional wildcard MCP denial. |

Current code incorrectly lowers `*` to regex-style `.*`, producing invalid rules
such as `mcp__.*__.*`. That bug is tracked by SET-257 and should be folded into
the `tools` cutover rather than patched twice if this redesign lands first.

## Registry and Lowering Architecture

The registry describes facts keyed by base-layer aspects:

- where the intent can be realized: skill frontmatter, agent definition, hook,
  project/user config, managed policy, settings suggestion, metadata, or
  nowhere;
- the realization tier: `native`, `transformed`, `derived`, `approximate`,
  `advisory`, `metadata-only`, `settings-required`, or `unsupported`;
- the emitted provider field or rule when there is one;
- diagnostics for partial or contradictory lowering;
- evidence backing the row.

Transforms, such as converting `mcp.github: [get_*]` into
`mcp__github__get_*`, stay in small provider-specific code. The registry should
not become a declarative rules engine.

Renderers must consume registry facts instead of hard-coding all mappings in
`skill-policy.ts` and `render.ts`. Codex per-tool enablement and Cursor hook
matcher realizations need provider evidence before the registry claims them.

## Explain Output

`skillset explain <unit> --target <provider>` should show a per-target,
per-surface resolution table:

```text
intent key -> deciding layer -> realization tier -> emitted field/rule -> residual-risk diagnostic
```

The deciding layer is one of macro expansion, base, provider override, or native
overlay. This makes precedence and residual risk inspectable.

Example diagnostics:

- "rendered Cursor `readonly: true` for `write: false`";
- "Claude tool allowlist removes Write/Edit, but Bash can still change state
  unless paired with hooks or permission settings";
- "Cursor has no proven per-agent MCP allowlist; inherited MCP tools may remain
  available."

## Settings Boundary

`skillset build` must not mutate user, local, managed, or trusted-project
provider configuration. Renderings that require settings, hooks, permission
profiles, project config, or user config are emitted as reviewed settings
suggestions or must come from explicit provider-native source.

## Consequences

### Positive

- Authors get a compact source shape: `tools: readonly` or lowercase portable
  keys.
- Provider-native strings stay visibly provider-native.
- Tool authority can lower to skills, agents, hooks, settings suggestions, and
  diagnostics without forcing provider field names into the shared source
  contract.
- The registry gains a clear job: facts about realization, not string
  transforms or macro expansion.

### Tradeoffs

- Some provider surfaces remain advisory or diagnostic-only until runtime
  evidence proves stronger support.
- Native `allow` contradiction detection requires a small classifier.
- The first implementation intentionally omits path-scoped read/write/search,
  wildcard-server MCP grants, and portable web/edit keys.

### Deferred

- Per-server mixed MCP maps such as `github: { get_*: true, create_*: false }`.
- Path-scoped `read`, `write`, and `search`.
- Additional macros such as `no-network`.
- Selector objects if a provider grows enforceable two-dimensional MCP allow
  globs.
- Portable `web_fetch`, `web_search`, and `edit` after a provider-realization
  audit.

## References

- [Tenets](../../tenets.md) - source-first, provider-native, fail-loud design principles.
- [Feature Reference and Schema Registry](20260604-feature-reference-and-schema-registry.md) - registry-backed feature and capability evidence.
- [Agent / Subagent Source Model](20260604-agent-source-model.md) - project-agent and plugin-agent boundaries.
- [Lowering Outcomes and Loss Ledger](20260614-lowering-outcomes-and-loss-ledger.md) - visible degraded, lossy, and unsupported render results.
- [Reviewed Settings Suggestions](20260604-reviewed-settings-suggestions.md) - authority-changing settings are reviewable plans, not build side effects.
- [Cursor Is a First-Class Provider](0002-cursor-is-a-first-class-provider.md) - Cursor-specific provider boundary this ADR specializes.
- [Portable `tools` Policy — Locked Design](../../../.scratch/notes/20260702-tools-policy-locked-design.md) - detailed working note and rejected alternatives.
- [Claude subagents docs](https://code.claude.com/docs/en/sub-agents) - subagent fields, tools, permission modes, MCP, hooks, background, and isolation, checked 2026-07-02.
- [Codex subagents docs](https://developers.openai.com/codex/subagents) - custom agents as config layers and inherited sandbox/approval behavior, checked 2026-07-02.
- [Codex approvals and security docs](https://developers.openai.com/codex/agent-approvals-security) - sandbox, approval, network, and permission controls, checked 2026-07-02.
- [Cursor subagents docs](https://cursor.com/docs/subagents) - `readonly`, `is_background`, cloud subagents, inheritance, and custom-agent locations, checked 2026-07-02.

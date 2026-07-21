---
id: 20
slug: portable-skill-tools-policy
title: Portable Skill Tools Policy
status: accepted
created: 2026-07-02
updated: 2026-07-20
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, 2, 5, 18]
---

# ADR-0020: Portable Skill Tools Policy

## Context

Skillset's portable tool-policy source shape is the author-facing `tools`
block. It expresses skill-local intent without pretending provider
preapproval, metadata, or settings evidence is a universal security sandbox.

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

Use a first-class `tools` block. The block has three
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
- **`true`** renders to a supported skill-local grant or preapproval mechanism.
- **`false`** renders to a supported skill-local constraint or reviewable metadata fact.
- **No surface for the intent** emits a diagnostic; never silently pretend
  portability.

Never synthesize a closed allowlist from open-world source. For example, Claude
subagent `tools` is a closed list: listing `Read` would deny everything
unlisted. Rendering `read: true` into that field would be stricter than the
author said. Grants render to grants; denials render to denials. If a surface only
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

The composite "no writes, no state-changing shell" intent is carried by
`write: false`. Claude can render supported skill-local rules with residual
Bash/MCP risk reported. Codex and Cursor retain reviewable
`.skillset.tools.yaml` metadata plus `settings-required` evidence; this
skill-local policy does not emit or control an enclosing sandbox or readonly
agent setting.

## Portable Keys

The first implementation supports this fenced vocabulary:

| Key | Value shape | Notes |
| --- | --- | --- |
| `read` | `true` / `false` | Boolean only; path scoping is deferred. |
| `search` | `true` / `false` | Boolean only; path scoping is deferred. |
| `write` | `true` / `false` | Composite intent including file writes and state-changing shell. |
| `shell` | `true` / `false` / flat list of pattern strings | Named `shell`, not `bash`; Claude renders supported native rules, while Codex and Cursor retain reviewable metadata and report settings-required evidence for stronger enforcement. |
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

Claude rendering produces `Bash(git status)`, `Bash(git diff *)`, and
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

`write: false` is portable skill intent, not a universal enforcement envelope.
Explicit shell entries are invocation grants within that intent. Claude emits
the strongest supported skill-local rules plus residual-risk diagnostics;
Codex and Cursor preserve metadata and stronger-setting requirements without
claiming runtime enforcement. Skillset does not statically classify shell
patterns as mutating or non-mutating.

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

`mcp: false` expresses whole-MCP denial intent. Claude renders that intent as a
native denial; Codex and Cursor preserve reviewable metadata and
settings-required evidence rather than claiming control of the enclosing MCP
runtime.

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
| `mcp: false` | `disallowed-tools: mcp__*` | Claude rendering of whole-MCP denial intent; other providers retain metadata/settings-required evidence. |

SET-257 corrected MCP glob rendering: literal server names retain provider-native
tool globs and whole-MCP denial uses the documented wildcard form. Focused tests
pin the valid output.

## Registry and Realization Architecture

The registry describes facts keyed by base-layer aspects:

- where the intent can be realized: skill frontmatter, agent definition, hook,
  project/user config, managed policy, settings suggestion, metadata, or
  nowhere;
- the realization tier: `native`, `transformed`, `derived`, `approximate`,
  `advisory`, `metadata-only`, `settings-required`, or `unsupported`;
- the emitted provider field or rule when there is one;
- diagnostics for partial or contradictory realization;
- evidence backing the row.

Transforms, such as converting `mcp.github: [get_*]` into
`mcp__github__get_*`, stay in small provider-specific code. The registry is
not a declarative rules engine.

Renderers consume registry facts instead of hard-coding all mappings in
`skill-policy.ts` and `render.ts`. Unsupported stronger provider surfaces stay
as explicit evidence gaps rather than inferred capabilities.

## Explain Output

`skillset explain <unit> --target <provider>` shows a per-target,
per-surface resolution table:

```text
intent key -> deciding layer -> realization tier -> emitted field/rule -> residual-risk diagnostic
```

The deciding layer is one of macro expansion, base, provider override, or native
overlay. This makes precedence and residual risk inspectable.

Example diagnostics:

- "Cursor skill policy remains metadata-only; readonly enforcement requires settings";
- "Claude tool allowlist removes Write/Edit, but Bash can still change state
  unless paired with hooks or permission settings";
- "Cursor has no proven per-agent MCP allowlist; inherited MCP tools may remain
  available."

## Settings Boundary

`skillset build` must not mutate user, local, managed, or trusted-project
provider configuration. Realizations that require settings, hooks, permission
profiles, project config, or user config are reported as `settings-required`
evidence. Skillset does not emit those authority-changing settings; they must
come from separately reviewed provider-native source or configuration.

## Consequences

### Positive

- Authors get a compact source shape: `tools: readonly` or lowercase portable
  keys.
- Provider-native strings stay visibly provider-native.
- Skill-local tool intent renders to Claude-native rules or reviewable
  Codex/Cursor metadata and diagnostics without forcing provider field names
  into the shared source contract.
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

## Acceptance Evidence (2026-07-20)

The implemented source surface is a
skill-local `tools` policy with `readonly`, five portable capability keys,
provider overrides, native allow/deny overlays, open-world semantics,
precedence, contradiction checks, literal MCP-server validation, registry-backed
realization, and explainability.

This policy does not control an enclosing Codex or Cursor agent, sandbox, hook
runtime, MCP runtime, or provider settings. Claude can transform supported
skill policy into native frontmatter, with residual Bash/MCP risk reported.
Codex and Cursor retain reviewable `.skillset.tools.yaml` metadata; stronger
sandbox or readonly settings are `settings-required` evidence and are not
emitted. `write: false` is portable skill intent, not a universal enforcement
claim. Current proof is in `docs/features/tools-policy.md`, `skill-policy.ts`,
`tools-realization.ts`, and their focused tests.

## References

- [Tenets](../tenets.md) - source-first, provider-native, fail-loud design principles.
- [Feature Reference and Schema Registry](0005-feature-reference-and-schema-registry.md) - registry-backed feature and capability evidence.
- [Agent / Subagent Source Model](0006-agent-source-model.md) - project-agent and plugin-agent boundaries.
- [Render Results](0018-render-results.md) - visible degraded, lossy, and unsupported render results.
- [Reviewed Settings Suggestions](drafts/20260604-reviewed-settings-suggestions.md) - authority-changing settings are reviewable plans, not build side effects.
- [Cursor Is a First-Class Provider](0002-cursor-is-a-first-class-provider.md) - Cursor-specific provider boundary this ADR specializes.
- [Portable `tools` Policy — Locked Design](../../.scratch/notes/20260702-tools-policy-locked-design.md) - detailed working note and rejected alternatives.
- [Claude subagents docs](https://code.claude.com/docs/en/sub-agents) - subagent fields, tools, permission modes, MCP, hooks, background, and isolation, checked 2026-07-02.
- [Codex subagents docs](https://developers.openai.com/codex/subagents) - custom agents as config layers and inherited sandbox/approval behavior, checked 2026-07-02.
- [Codex approvals and security docs](https://developers.openai.com/codex/agent-approvals-security) - sandbox, approval, network, and permission controls, checked 2026-07-02.
- [Cursor subagents docs](https://cursor.com/docs/subagents) - `readonly`, `is_background`, cloud subagents, inheritance, and custom-agent locations, checked 2026-07-02.

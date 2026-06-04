---
slug: agent-source-model
title: Agent / Subagent Source Model
status: draft
created: 2026-06-04
updated: 2026-06-04
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0]
---

# ADR: Agent / Subagent Source Model

Status: research + recommendation (SET-13). No implementation.

Recommendation in one line: **defer a portable agent-role abstraction in v1.** Keep Claude `agents/` as target-native pass-through; do not emit Codex agents until Codex documents a plugin-agent surface.

## Context

The tenets say to lower intent, not filenames, and that target truth beats fake portability. Claude subagent files and any Codex agent concept are *close matches* at best, so this needs a deliberate decision rather than a reflexive "copy Claude `agents/` into Codex."

## Current target facts

Live-doc checked 2026-06-03.

- **Claude** (`code.claude.com/docs/en/plugins-reference`): a plugin's `agents/` directory holds markdown files describing specialized **subagents** Claude can invoke automatically. It is a first-class plugin component with a manifest `agents` path field.
- **Codex** (`developers.openai.com/codex/plugins`): a Codex plugin's documented components are **skills, apps, and MCP servers**. There is *no* standalone `agents/` / `subagents` plugin component. Codex's only agent-shaped surface is per-skill: `agents/openai.yaml` *inside* a skill, which Skillset already uses to lower `implicit_invocation` and Codex tool/policy metadata.

So the two "agent" concepts are not the same shape:

| Concern | Claude | Codex |
| --- | --- | --- |
| Standalone subagent files | `agents/*.md` (plugin component) | none documented |
| Per-skill agent config | n/a | `agents/openai.yaml` (skill-local) |
| Invocation model | Claude picks a subagent for a task | skill-level policy |

## Author intent Skillset could model

There are two distinct intents tangled in "agents":

1. **A reusable specialized role** ("a reviewer subagent"). Claude models this as `agents/*.md`. Codex has no plugin-level equivalent today.
2. **Per-skill agent behavior** (implicit invocation, tool dependencies). Both targets express this; Skillset already lowers it (`implicit_invocation`, `tool_intent`, `agents/openai.yaml`).

Intent (2) is already portable and implemented. Intent (1) has no faithful Codex lowering, so a portable source key for it would either drop on Codex (fake portability) or invent an unproven Codex surface (target untruth). Both violate the tenets.

## What normalizes safely vs stays target-native

- **Safe to normalize (already done):** per-skill agent policy — implicit invocation and tool intent — via existing portable keys.
- **Must stay target-native (now):** standalone subagent roles. Claude `agents/` is copied as opaque target-native content into Claude plugin output only; it is intentionally not copied into Codex output (the evidence matrix marks Codex agent output **Deferred**).

## Decision

Defer a portable `agents` abstraction. Concretely:

- Keep Claude `agents/*.md` as a **target-native pass-through** plugin companion path (current behavior). Do not introduce a portable `agent:`/`agents:` source key in v1.
- Do **not** synthesize Codex agents from Claude `agents/`. Codex agent output stays an explicit deferred boundary.
- If a future author needs a Codex-native standalone agent and Codex documents one, add it as a **Codex-native pass-through path** (mirroring how `.app.json` is handled), not as a portable abstraction — unless Claude and Codex converge on equivalent semantics, at which point revisit normalization.

This keeps the happy path small, preserves target truth, and avoids a v1 abstraction the tenets explicitly warn against ("Skillset should not introduce a separate `agents` abstraction in v1").

## Consequences

Claude `agents/` remains useful without forcing a false Codex equivalent. Codex agent-like behavior stays limited to validated skill-local policy until Codex documents a plugin-level surface or Skillset designs a faithful intent model.

The cost is that authors who want cross-target specialized roles cannot write one portable `agents` source yet. That is an honest unsupported boundary rather than a silent drop or speculative translation.

## Fixture / test implications

- Current tests already assert Claude `agents/` is copied into Claude plugin output and **absent** from Codex output (`skillset.test.ts` "plugin manifests keep agent and hook surfaces target-specific"). That pins the deferral.
- When/if a Codex-native agent surface is added, add a kitchen-sink fixture path plus a golden manifest assertion, and a row in `docs/target-surfaces.md` moving Codex agents from **Deferred** to **Implemented (pass-through)**.
- No new fixtures are needed for the v1 deferral beyond what exists.

## Open questions for a future revisit

- Does Codex add a documented plugin-level agent/subagent component? (Re-check `developers.openai.com/codex/plugins` periodically; the evidence matrix row is the trigger.)
- If Claude `agents/*.md` and a future Codex agent format share enough structure (frontmatter + body), is a thin portable `agents/` source worth it, or do pass-through paths per target stay clearer?

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - baseline source-first compiler doctrine.
- [Tenets](../../tenets.md) - target truth and intent-lowering principles.
- [Target Surface Evidence Matrix](../../target-surfaces.md) - current Claude/Codex plugin surface status.

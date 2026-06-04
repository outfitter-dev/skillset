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

Recommendation in one line: **defer a plugin-level portable agent-role abstraction in v1, but support project-scoped agents through an explicit portable project-agent source model.** Keep Claude plugin `agents/` as target-native pass-through; do not copy it into Codex plugins.

## Context

The tenets say to lower intent, not filenames, and that target truth beats fake portability. Claude subagent files and any Codex agent concept are *close matches* at best, so this needs a deliberate decision rather than a reflexive "copy Claude `agents/` into Codex."

## Current target facts

Live-doc checked 2026-06-04.

- **Claude project/user agents** (`code.claude.com/docs/en/sub-agents`): `.claude/agents/*.md` and `~/.claude/agents/*.md` define custom subagents as Markdown files with YAML frontmatter. Project agents are shareable repo configuration; user agents are personal runtime configuration.
- **Claude plugin agents** (`code.claude.com/docs/en/plugins` and `code.claude.com/docs/en/plugins-reference`): a plugin's `agents/` directory holds Markdown subagent definitions. It is a first-class plugin component with a manifest `agents` path field.
- **Codex project/user agents** (`developers.openai.com/codex/subagents`): `.codex/agents/*.toml` and `~/.codex/agents/*.toml` define custom agents as standalone TOML files. Each file must include `name`, `description`, and `developer_instructions`.
- **Codex plugins** (`developers.openai.com/codex/plugins/build`): documented plugin components include skills, hooks, apps, MCP servers, and assets. They do not document a plugin `agents/` component.
- **Codex skill-local agent policy**: `agents/openai.yaml` inside a skill remains a skill-local policy surface that Skillset already uses to lower `implicit_invocation` and Codex tool/policy metadata. It is not the same thing as a project custom agent.

So the agent-shaped concepts are related but not interchangeable:

| Concern | Claude | Codex |
| --- | --- | --- |
| Project-scoped custom agent | `.claude/agents/*.md` | `.codex/agents/*.toml` |
| Plugin-scoped custom agent | plugin `agents/*.md` | none documented |
| Per-skill agent config | n/a | `agents/openai.yaml` (skill-local) |
| Authoring format | Markdown + YAML frontmatter | TOML with `developer_instructions` |
| Invocation model | Claude delegates to subagents by description; `claude --agent` can run one as main | Codex spawns custom agents explicitly in subagent workflows |

## Author intent Skillset could model

There are three distinct intents tangled in "agents":

1. **A reusable project-scoped specialized role** ("a reviewer agent checked into this repo"). Claude models this as `.claude/agents/*.md`; Codex models this as `.codex/agents/*.toml`. These are close enough to design a portable project-agent source, with target-specific field validation and no silent drops.
2. **A plugin-scoped reusable specialized role** ("a reviewer agent distributed with this plugin"). Claude models this as plugin `agents/*.md`. Codex has no documented plugin-level equivalent today.
3. **Per-skill agent behavior** (implicit invocation, tool dependencies). Skillset already lowers this where validated (`implicit_invocation`, `tool_intent`, `agents/openai.yaml`).

Intent (1) is the SET-24 project-agent scope. Intent (2) has no faithful Codex plugin lowering, so a portable plugin-agent source key would either drop on Codex or invent an unproven Codex plugin surface. Intent (3) is already separate from project/plugin custom agents and should not be used to fake project-agent parity.

## What normalizes safely vs stays target-native

- **Safe to normalize (planned):** project-scoped specialized roles authored as Markdown/frontmatter under Skillset source and lowered to `.claude/agents/*.md` and `.codex/agents/*.toml` with target-specific validation.
- **Safe to normalize (already done):** per-skill agent policy — implicit invocation and tool intent — via existing portable keys.
- **Must stay target-native (now):** plugin-scoped subagent roles. Claude plugin `agents/` is copied as opaque target-native content into Claude plugin output only; it is intentionally not copied into Codex plugin output.

## Decision

Defer a portable plugin `agents` abstraction, while allowing SET-24 to implement portable project-scoped agents. Concretely:

- Keep Claude plugin `agents/*.md` as a **target-native pass-through** plugin companion path. Do not copy it into Codex plugin output.
- Add project agents through a separate source path and renderer, not by reusing plugin `agents/` or skill-local `agents/openai.yaml`.
- Do **not** synthesize Codex plugin agents from Claude plugin `agents/`. Codex plugin-agent output stays unsupported until Codex documents a plugin component.
- If a future author needs Codex-native plugin agents and Codex documents that component, add it as a **Codex-native pass-through path** first. Revisit portability only if the target outcomes genuinely converge.

This keeps the happy path small, preserves target truth, and avoids a v1 abstraction the tenets explicitly warn against ("Skillset should not introduce a separate `agents` abstraction in v1").

## Consequences

Claude plugin `agents/` remains useful without forcing a false Codex plugin equivalent. Codex project custom agents can still be supported through their documented `.codex/agents/*.toml` location, and Codex skill-local policy stays limited to validated skill behavior.

The cost is that plugin authors who want cross-target specialized roles cannot write one portable plugin `agents` source yet. That is an honest unsupported boundary rather than a silent drop or speculative translation.

## Fixture / test implications

- Current tests already assert Claude plugin `agents/` is copied into Claude plugin output and **absent** from Codex plugin output (`skillset.test.ts` "plugin manifests keep agent and hook surfaces target-specific"). That pins the plugin-agent deferral.
- SET-24 should add project-agent fixtures for `.skillset/src/agents/*.md` lowering to Claude `.claude/agents/<name>.md` and Codex `.codex/agents/<name>.toml`, plus validation coverage for required target fields.
- When/if a Codex-native plugin agent surface is added, add a kitchen-sink fixture path plus a golden manifest assertion, and a row in `docs/target-surfaces.md` moving Codex plugin agents from **Unsupported / Deferred** to **Implemented (pass-through)**.

## Open questions for a future revisit

- Does Codex add a documented plugin-level agent/subagent component? Re-check `developers.openai.com/codex/plugins/build` periodically; the evidence matrix row is the trigger.
- If Claude plugin `agents/*.md` and a future Codex plugin agent format share enough structure, is a thin portable plugin-agent source worth it, or do pass-through paths per target stay clearer?
- How much target-native Codex agent configuration should project-agent source expose before it becomes better represented as a Codex source island?

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - baseline source-first compiler doctrine.
- [Tenets](../../tenets.md) - target truth and intent-lowering principles.
- [Target Surface Evidence Matrix](../../target-surfaces.md) - current Claude/Codex plugin surface status.

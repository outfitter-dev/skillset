---
slug: cursor-is-a-first-class-provider
title: Cursor Is a First-Class Provider
status: draft
created: 2026-07-02
updated: 2026-07-02
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, feature-reference-and-schema-registry, agent-source-model, lowering-outcomes-and-loss-ledger]
---

# ADR: Cursor Is a First-Class Provider

## Context

Skillset has treated Cursor as a runtime candidate while Claude and Codex were the
only compile targets. That boundary was useful while Cursor evidence was thin, but
the current Cursor surface is now broad enough that a compatibility shim would be
the wrong model.

Cursor documents first-class project and plugin surfaces:

- skills at `.cursor/skills/<skill>/SKILL.md`;
- rules at `.cursor/rules/**/*.mdc`, with `AGENTS.md` also documented as a
  guidance input;
- subagents at `.cursor/agents/*.md`, including Cursor-native frontmatter such as
  `readonly` and `is_background`;
- plugins with `.cursor-plugin/plugin.json`, root component directories for
  `rules/`, `skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `mcp.json`,
  `assets/`, `scripts/`, and `README.md`;
- marketplaces at root `.cursor-plugin/marketplace.json`;
- MCP server config under `mcpServers` in plugin-root `mcp.json`;
- hooks using Cursor lower-camel events such as `sessionStart`,
  `beforeShellExecution`, `afterFileEdit`, `beforeSubmitPrompt`, `preCompact`,
  `workspaceOpen`, and others.

The local Cursor CLI also exposes non-interactive runtime machinery through
`agent` / `cursor-agent` with `--print`, `--output-format`, `--mode plan|ask`,
`--sandbox`, `--trust`, `--plugin-dir`, and `--workspace`. That is enough to make
runtime smoke tests a first-class verification path once target output exists.

The danger is to treat Cursor as "Claude-shaped" or "Codex-shaped" because some
filenames look familiar. Cursor hooks share concepts with Claude and Codex, but
their event spelling, event set, command payloads, and project/plugin activation
surfaces are Cursor-native. Cursor subagents share Markdown and YAML with Claude,
but `readonly` and `is_background` are Cursor capabilities, not portable facts by
default. Cursor plugins share root component directories with the other providers,
but `.cursor-plugin` is its own destination contract.

## Decision

Cursor is a first-class Skillset provider. Skillset will add `cursor` as a
compile target only through provider-evidence, target schema, registry support,
renderer, import, conformance, and runtime-test slices that preserve Cursor-native
truth.

This means:

- `compile.targets` may include `cursor` only after `@skillset/schema`,
  `@skillset/core`, `@skillset/registry`, Workbench, lookup, and generated schema
  artifacts all agree that `cursor` is a valid target.
- Cursor provider evidence belongs in `@skillset/registry` with the same offline,
  checked-in provenance model used for Claude and Codex. Current provider target
  unions must become extensible enough for Cursor evidence instead of growing
  Claude/Codex-only special cases.
- Cursor output must use Cursor-native destinations:
  - project skills under `.cursor/skills/`;
  - project rules under `.cursor/rules/` as `.mdc`;
  - project subagents under `.cursor/agents/`;
  - plugin bundles under `plugins/<plugin>/cursor/` by default, with
    `.cursor-plugin/plugin.json` inside the generated bundle;
  - plugin-local Cursor provider source from `.skillset/plugins/<plugin>/_cursor/**`;
  - workspace-level Cursor provider source from `.skillset/_cursor/**`.
- Cursor renderers must dogfood the feature registry and provider evidence before
  claiming a feature is native, transformed, shimmed, metadata-only, degraded,
  lossy, or unsupported.
- Imported Cursor files remain provider-native first. Skillset may lift a Cursor
  hook, rule, subagent, or plugin component into adaptive source only when registry
  facts prove the event, matcher, handler, scope, runtime behavior, and output
  destination can be preserved faithfully.
- Cursor-specific capability keys stay explicit inside `cursor` blocks or
  provider-native source until there is a proven portable meaning. `readonly` and
  `is_background` are good Cursor-native facts; any future portable capability
  vocabulary must be grounded in an intent model that records provider support,
  realization, degradation, and unsupported diagnostics.
- Runtime testing must use the real local Cursor CLI in isolated workspaces and
  local plugin directories. It must not install, trust, mutate user config, or rely
  on global provider state as a side effect of build.

The provider contract is deliberately stronger than "make Cursor compile." The
test is whether `skillset lookup`, `skillset explain`, build diagnostics,
render results, locks, docs, fixtures, and runtime-tester output all tell the same
truth for Cursor that they tell for Claude and Codex.

## Implementation Milestones

The Cursor provider parity stack should proceed in milestone order. If a later
slice discovers missing provider facts, it must update the registry/design first
instead of patching the renderer locally.

| Milestone | Required outcome |
| --- | --- |
| Evidence and contract | Cursor docs and local CLI evidence are recorded; this ADR and the portable capability/permission intent model define what can be native, transformed, shimmed, degraded, lossy, or unsupported. |
| Target and output plumbing | `cursor` is accepted by schema/core/registry/Workbench/lookup; output roots, `_cursor` source islands, locks, safety checks, and generated schema artifacts include Cursor. |
| Native renderers | Skills, rules, subagents, plugins, marketplaces, MCP, hooks, commands, and provider-native companions render only where Cursor has a faithful destination. |
| Import and runtime proof | Cursor imports preserve native source unless a faithful adaptive lift exists; runtime-tester dogfoods generated Cursor output with the local CLI in isolated workspaces. |
| Parity gate | Adapter conformance, deterministic projection, fixtures, docs, generated guidance, Linear, PR checks, and local review all agree that Cursor is fully working. |

## Consequences

### Positive

- Cursor support can be as complete as Claude/Codex support without being forced
  through either provider's vocabulary.
- Provider facts become more modular because the registry must support third-party
  provider packages and future provider evidence, not just hard-coded internal
  Claude/Codex unions.
- Diagnostics stay honest when Cursor can represent a feature differently, cannot
  represent it, or can only represent it through an explicit Cursor-native escape
  hatch.
- Runtime proof becomes reusable: the same non-interactive Cursor CLI machinery
  can later support evals, activation checks, and fixture reviews.

### Tradeoffs

- Adding Cursor is broader than adding another string to `TargetName`; schema
  artifacts, registry evidence, Workbench, lookup, docs, and conformance all need
  to move together.
- Some source that looks portable will remain provider-native until Cursor,
  Claude, and Codex capability facts prove an adaptive contract.
- The initial Cursor provider may require more fixture and runtime-test setup than
  a pure compile-only target because the CLI has meaningful activation behavior.

### What This Does NOT Decide

- It does not make Cursor the default target for new workspaces. That default
  belongs to the final parity gate after fixtures and runtime proof are green.
- It does not install Cursor plugins, trust workspaces, mutate `~/.cursor`, or
  change user-level Cursor configuration.
- It does not decide a universal permission/capability vocabulary. That model must
  be designed as portable intent plus provider declarations and provider-native
  realizations, then adopted only where proven.

## References

- [Tenets](../tenets.md) - source-first, provider-native, fail-loud design principles.
- [Feature Reference and Schema Registry](20260604-feature-reference-and-schema-registry.md) - registry-backed capability claims and evidence.
- [Agent / Subagent Source Model](20260604-agent-source-model.md) - project and plugin agent boundaries.
- [Lowering Outcomes and Loss Ledger](20260614-lowering-outcomes-and-loss-ledger.md) - vocabulary for transformed, degraded, lossy, and unsupported outcomes.
- [Runtime Adapters](../../features/runtime-adapters.md) - current target/runtime boundary.
- [Provider Surface Evidence Matrix](../../target-surfaces.md) - provider destination evidence and verification notes.
- [Cursor skills docs](https://cursor.com/docs/skills) - project skill surface, checked 2026-07-02.
- [Cursor rules docs](https://cursor.com/docs/rules) - project rules and `AGENTS.md`, checked 2026-07-02.
- [Cursor subagents docs](https://cursor.com/docs/subagents) - project subagent frontmatter, checked 2026-07-02.
- [Cursor plugins docs](https://cursor.com/docs/plugins) - plugin overview, checked 2026-07-02.
- [Cursor plugins reference](https://cursor.com/docs/reference/plugins) - plugin structure, marketplaces, hooks, and MCP, checked 2026-07-02.
- [Cursor hooks docs](https://cursor.com/docs/hooks) - hook runtime behavior and events, checked 2026-07-02.
- [Cursor MCP docs](https://cursor.com/docs/mcp) - MCP server configuration, checked 2026-07-02.
- [Cursor headless CLI docs](https://cursor.com/docs/cli/headless) - non-interactive CLI mode, checked 2026-07-02.

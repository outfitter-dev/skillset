---
slug: feature-reference-and-schema-registry
title: Feature Reference and Schema Registry
status: draft
created: 2026-06-04
updated: 2026-06-04
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0]
---

# ADR: Feature Reference and Schema Registry

Proposal for a feature-by-feature documentation and schema layer for Skillset.

## Status

Proposed. This document describes a documentation/tooling direction, not an implemented compiler contract.

## Context

Skillset is starting to cover a large surface area: skills, plugin manifests, rules/instructions, hooks, MCP servers, apps, resources, tool intent, agents, commands, executables, themes, monitors, LSP servers, settings, marketplace metadata, and target-specific escape hatches.

Today that knowledge is spread across tenets, layout docs, target-surface matrices, code, tests, and generated output. That makes it too easy for a feature to drift in one of three ways:

- The docs say a source feature lowers to a target, but the compiler does not.
- The compiler supports a target feature, but the docs do not explain the target nuance or unsupported cases.
- A near-match feature, such as Claude subagents versus Codex agent-like surfaces, is accidentally treated as portable because the names are similar.

Skillset needs a durable feature reference that explains authoring, target lowering, support status, schemas, diagnostics, and examples in one place.

## Decision

Create a feature-reference layer for Skillset docs and evolve it toward a schema-backed feature registry. The reference should explain each source feature, target lowering, support status, diagnostics, examples, and lock provenance. The schema registry should eventually separate portable feature schemas from Claude and Codex adapter schemas so target support can rev independently.

## Goals

- Give authors one index of Skillset features.
- Give each feature a focused page that explains how to write it in source and how it compiles for Claude and Codex.
- Make target support explicit: implemented, compat alias, portable, target-native, metadata-only, planned, reserved, deferred, unsupported, lossy, and future.
- Capture nuances within features, such as `SKILL.md` frontmatter keys, path-scoped instruction frontmatter, hook handler compatibility, and MCP server policy.
- Let future docs tables be generated from schemas or a feature registry so support flips do not require hand-updating several places.
- Separate portable feature schemas from Claude and Codex adapter schemas so target support can evolve independently.

## Non-goals

- Do not build a full docs generator before the reference shape is proven.
- Do not make unsupported target features look portable just because they appear in the reference.
- Do not replace ADRs. ADRs still record decisions; feature docs describe the current authoring and lowering contract.
- Do not move activation or trust into `skillset build`. The reference may document hooks, MCP servers, apps, and executables, but build still emits definitions only.
- Do not implement a settings suggestion/review workflow in v1. Target-native settings may be documented and copied only when explicitly authored and scoped by a later issue; live user/project config mutation is out of scope.
- Do not introduce shared model/reasoning alias profiles in v1. Use target-native fields such as Claude `model` / `effort` and Codex `model` / `model_reasoning_effort`.
- Do not introduce first-class `sets` for grouped marketplaces or bundles in v1. CLI scopes and typed entity selectors remain separate.
- Do not generate `docs/features` from a runtime schema in v1. Manual feature docs come first; registry-backed generation is future work.

## Documentation Shape

Add a generated-or-manual feature reference section:

```text
docs/
  features/
    README.md
    skills.md
    instructions.md
    plugins.md
    plugin-metadata.md
    resources.md
    tool-intent.md
    hooks.md
    mcp-servers.md
    apps.md
    agents.md
    commands.md
    executables.md
    output-styles.md
    themes.md
    monitors.md
    lsp-servers.md
    settings.md
```

The index should group features by support shape:

- **Portable**: same intent and faithful target lowering.
- **Near match**: similar target concepts that need careful intent modeling.
- **Target-native**: supported for one target only.
- **Metadata-only**: preserved for provenance, not enforced by the target.
- **Reserved / deferred / future**: named or understood, but not emitted yet.
- **Unsupported / lossy**: cannot lower faithfully for an enabled target without explicit scoping, diagnostics, and provenance.

## Feature Page Template

Each page should follow the same shape:

```markdown
# <Feature Name>

## Status

Short support summary.

## Authoring

How this is written in `.skillset/src` or source config.

## Schema

Source keys, frontmatter keys, path conventions, aliases, and defaults.

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |

## Examples

Small source example plus generated Claude/Codex snippets.

## Diagnostics

What lint/build/check should warn or fail on.

## Provenance

What should be recorded in `.skillset.lock`.

## Open Questions

Known target drift, missing docs evidence, or deferred design calls.
```

This keeps the page useful for both humans and future generator templates.

## Schema Registry

Once the manual shape is stable, introduce a feature registry that can drive docs, diagnostics, and adapter checks.

Possible source:

```text
src/schema/
  features/
    skills.schema.json
    hooks.schema.json
    mcp-servers.schema.json
  targets/
    claude.schema.json
    codex.schema.json
```

or a typed registry if TypeScript is easier to maintain:

```ts
export const features = [
  {
    id: "skills",
    title: "Skills",
    source: {
      paths: [".skillset/src/skills/<name>/SKILL.md"],
      schema: "SkillSource",
    },
    targets: {
      claude: {
        status: "implemented",
        outputs: ["skills/<name>/SKILL.md"],
        adapterSchema: "ClaudeSkill",
      },
      codex: {
        status: "implemented",
        outputs: ["skills/<name>/SKILL.md", "agents/openai.yaml"],
        adapterSchema: "CodexSkill",
      },
    },
    docs: {
      page: "docs/features/skills.md",
      order: 10,
    },
  },
] as const;
```

The registry should include:

- Feature id, title, and maturity.
- Source paths, source keys, and aliases.
- Target support status per provider.
- Target output paths and manifest fields.
- Validation ownership: portable resolver, Claude adapter, Codex adapter.
- Live-doc verification source/date for target surfaces.
- Lock provenance fields.
- Example fixture names or golden tests.

## Adapter Separation

The registry suggests a cleaner compiler split:

```text
src/
  features/
    skills/
    hooks/
    mcp-servers/
    instructions/
  targets/
    claude/
      schema.ts
      manifest.ts
      lower.ts
      validate.ts
    codex/
      schema.ts
      manifest.ts
      lower.ts
      validate.ts
```

The portable feature layer answers: "What did the author mean?"

The target adapter layer answers: "Can this target represent that meaning, and what native files should be emitted?"

Adapter schemas can rev independently. For example, Claude could add a new plugin component without changing the portable source schema immediately, while Codex could add a new app or hook shape without pretending Claude has the same feature.

## Support Vocabulary

Use one support vocabulary everywhere:

| Status | Meaning |
| --- | --- |
| `implemented` | Parsed, validated, rendered, tested, and documented. |
| `compat_alias` | Accepted legacy or native spelling that normalizes to the canonical source form. |
| `portable` | Authored once because enabled targets can represent the same intent faithfully. |
| `target_native` | Supported only through one target's native source or adapter path. |
| `metadata_only` | Captured in generated metadata or lock provenance, but not target-enforced. |
| `planned` | Accepted design with no parser/render support yet. |
| `reserved` | Recognized vocabulary that fails until provenance and behavior exist. |
| `deferred` | Intentionally not emitted; documented reason. |
| `unsupported` | Cannot lower to an enabled target without explicit target scoping or unsupported policy. |
| `lossy` | A possible lowering would drop target meaning or behavior; fail unless a future ADR defines visible provenance. |
| `future` | Outside the v1 contract but tracked as a possible later design. |

This vocabulary should match `docs/target-surfaces.md`, compiler diagnostics, and eventually generated feature pages.

## Example: Agents / Subagents

The feature-reference model is especially useful for non-portable concepts.

Claude:

- Has project/user `.claude/agents/*.md` subagent Markdown files.
- Has plugin `agents/` subagent Markdown files.
- Has project/user subagent behavior.
- Exposes agent-related plugin settings and status-line options.

Codex:

- Has skills, plugins, hooks, MCP servers, apps, and skill-local `agents/openai.yaml` policy.
- Has project/user `.codex/agents/*.toml` custom agents.
- Does not document a plugin `agents/` equivalent.

Feature page guidance:

- Document project-scoped agents as planned portable source where target semantics are close enough and validation can stay target-specific.
- Document Claude plugin `agents/` as target-native.
- Document Codex project agents and skill-local `agents/openai.yaml` separately so project role behavior is not confused with per-skill policy.
- Mark Codex plugin `agents/` as unsupported/deferred until Codex documents a plugin component.
- Make `compile.unsupported` fail if a Claude-only plugin-agent source is compiled for Codex without explicit target scoping or visible unsupported provenance.

## Target Boundary Examples

Codex `AGENTS.md` and Codex `.rules` should not share a feature page as if they were equivalent. `AGENTS.md` is project guidance prose discovered from repo directories. `.rules` files are command execution policy under active Codex config-layer `rules/` directories. Lowering instruction Markdown into `.rules` would be lossy and should fail; mirroring explicitly authored Codex `.rules` through a target-native source island is a separate feature.

Claude plugin-root `bin/` and `settings.json` are now documented target-native components. `bin/` can become a feature-key/source-pointer surface for executable helpers. `settings.json` must remain separate from live user/project settings mutation: Skillset may document or copy explicitly authored plugin settings in a future adapter slice, but v1 does not suggest, install, or mutate runtime config.

## Example: Skills Frontmatter

The skills page should drill into subfeatures:

- Identity: `name`, `skillset.name`, directory-derived ids.
- Description fields: `title`, `summary`, `description`.
- Version fields: source schema version versus product version.
- Resources: `resources.references`, `resources.scripts`, `resources.assets`, external `from` pointers if adopted.
- Invocation policy: `implicit_invocation`.
- Tool policy: `tool_intent`, `allowed_tools`, and target-native escapes.
- Target toggles: `claude: false`, `codex: false`, and target-specific blocks.

Each subfeature can have a row in the target-lowering table, plus examples and diagnostics.

## Tooling Path

Phase 1: Manual feature docs

- Create `docs/features/README.md`.
- Add initial pages for `skills`, `instructions`, `plugins`, `hooks`, `mcp-servers`, `apps`, `agents`, and `executables`.
- Link existing `docs/target-surfaces.md` rows to feature pages.

Phase 2: Registry-backed support tables

- Introduce a typed feature registry.
- Generate the support matrix portions of `docs/features/README.md` and each feature's target-lowering table.
- Keep prose manual around generated tables.

Phase 3: Compiler integration

- Use the registry for diagnostics, `skillset explain`, `skillset doctor`, and `.skillset.lock` provenance.
- Require each implemented feature to point to tests and docs.

Phase 4: Adapter versioning

- Add explicit Claude and Codex adapter schema versions.
- Record adapter versions in generated lockfiles.
- Let adapter support move independently from portable source schema support.

## Consequences

The feature reference gives authors and agents one place to understand what Skillset supports and why. If the registry later drives generated tables, `lint`, `doctor`, and `explain`, support changes can become less dependent on manually synchronized prose.

The tradeoff is a larger documentation surface and eventual schema maintenance burden. The first slice should stay manual until the page shape proves itself.

## Open Questions

- Should the first feature docs be manually authored before introducing any schema generator?
- Should feature schemas be JSON Schema files, TypeScript registry objects, or both?
- Should target adapters own their schemas entirely, or should shared feature schemas include target sections?
- How much of `docs/target-surfaces.md` should remain once feature pages exist?
- Should `skillset lint` include a "docs coverage" check for implemented features?
- Should unsupported-target diagnostics link directly to feature docs?

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - baseline source-first compiler doctrine.
- [Tenets](../../tenets.md) - source-first, lower-intent, and drift-visible principles.
- [Target Surface Evidence Matrix](../../target-surfaces.md) - current compact support matrix that feature pages could extend or generate from.

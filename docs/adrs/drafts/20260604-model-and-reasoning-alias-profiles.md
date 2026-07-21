---
slug: model-and-reasoning-alias-profiles
title: Model and Reasoning Alias Profiles
status: draft
created: 2026-06-04
updated: 2026-06-04
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, 6, 5]
---

# ADR: Model and Reasoning Alias Profiles

## Context

Skillset v1 intentionally treats model choice as target-native. Claude and Codex both expose model and reasoning controls, but the field names, valid values, scopes, and target behavior are not portable enough for a shared top-level `model` key.

Current v1 behavior is conservative:

- authors use exact target fields such as `claude.model`, `claude.effort`, `codex.model`, and `codex.model_reasoning_effort`;
- authors use `claude.defaults.<surface>`, `codex.defaults.<surface>`, or the `defaults.<target>.<surface>` shorthand to avoid repeating exact target fields;
- a top-level skill or project-agent `model` is source-only and warns unless every enabled target already has an exact target model from file-level overrides or target defaults;
- Skillset does not resolve shared aliases such as `model: review`, `model: fast`, or `effort: deep`.

Aliases are still useful. Authors often want durable intent names like `review`, `fast`, and `deep`, while target model IDs and reasoning controls change at provider speed. A future profile layer could let a repo define "what review means here" once and lower that intent to Claude and Codex native fields.

The design must not weaken the v1 boundary. A bare `model` key still looks like target truth and should not silently become portable. Aliases need an explicit source key, target-specific definitions, strict validation, and precedence that does not surprise authors already using exact target overrides.

## Decision

Keep model/reasoning aliases deferred in SET-30, but reserve the following future shape.

Profiles live under a root `profiles.models` namespace:

```yaml
profiles:
  models:
    review:
      description: "Default review-grade model choice for this repo."
      claude:
        model: claude-review-model
        effort: high
      codex:
        model: codex-review-model
        model_reasoning_effort: high
    fast:
      claude:
        model: claude-fast-model
      codex:
        model: codex-fast-model
        model_reasoning_effort: low
```

Source files reference a profile with `model_profile`, not `model`:

```markdown
---
description: Reviews project changes.
model_profile: review
---

Review diffs and explain risk.
```

The first supported surface should be portable project agents. Skills can follow only after the project-agent behavior proves the diagnostics and precedence. Plugin manifests, hooks, MCP definitions, settings, and install workflows are out of scope for model profiles until a later ADR expands the surface deliberately.

## Schema Contract

The future schema should be strict:

- `profiles` is a root-only object.
- `profiles.models` is an object keyed by profile name.
- Profile names must be stable identifier strings using lowercase letters, digits, hyphens, and underscores, starting with a letter. This keeps names usable in diagnostics and future lock provenance.
- `description` is optional, must be a string when present, and is source-only documentation.
- Only `claude` and `codex` target blocks are accepted inside a model profile.
- Target blocks may contain only the fields listed below for the selected surface.
- Field values must be non-empty strings.
- Each target block for an enabled target must include `model`. Reasoning fields are optional.
- Unknown profile keys, unknown target keys, non-string values, and empty strings fail before rendering.

Profile definitions are target-specific by design:

- `profiles.models.<name>.claude.model` lowers to Claude agent frontmatter `model`.
- `profiles.models.<name>.claude.effort` lowers to Claude agent frontmatter `effort` where the target surface supports it.
- `profiles.models.<name>.codex.model` lowers to Codex custom-agent TOML `model`.
- `profiles.models.<name>.codex.model_reasoning_effort` lowers to Codex custom-agent TOML `model_reasoning_effort`.

Do not introduce shared `model` or `effort` fields inside the profile body. The alias name is portable; the values remain target-native.

## Resolution Precedence

For each enabled target and field, resolution should be:

1. File-level exact target override, such as `claude.model`, `claude.effort`, `codex.model`, or `codex.model_reasoning_effort`.
2. File-level `model_profile` resolved through `profiles.models.<name>.<target>`.
3. Plugin-level exact target defaults for that surface.
4. Root exact target defaults for that surface.
5. Target's own runtime default, if the target allows omission.

Exact target-native fields always win over an alias for the same field. Defaults fill target fields only after a valid profile target block has resolved. They do not make an incomplete profile valid. If `model_profile: review` is used while Codex is enabled, `profiles.models.review.codex.model` must exist even if `codex.defaults.agents.model` also exists.

This lets an author say "mostly use the `review` profile, but this one Claude agent needs a different model" without redefining the whole profile:

```markdown
---
description: Reviews risky migrations.
model_profile: review
claude:
  model: claude-migration-specialist
codex:
  model_reasoning_effort: medium
---

Review database migrations.
```

That source would lower as:

```markdown
---
name: migration-reviewer
description: Reviews risky migrations.
model: claude-migration-specialist
effort: high
---

Review database migrations.
```

```toml
name = "migration-reviewer"
description = "Reviews risky migrations."
model = "codex-review-model"
model_reasoning_effort = "medium"
developer_instructions = "Review database migrations."
```

## Validation and Diagnostics

Validation should fail loudly when an alias cannot lower faithfully:

- `model_profile` references an unknown profile.
- A profile omits a target block or required `model` field for an enabled target. Target defaults and file-level exact overrides do not satisfy a missing active target block; they only override or fill fields after the profile target block exists.
- A profile target block uses an unknown target key.
- A profile target block uses a field that the selected surface does not support.
- A profile attempts to configure non-model behavior such as tools, permissions, prompts, plugin activation, MCP servers, or settings.
- `model_profile` appears on an unsupported surface.
- A file sets both future `model_profile` and a top-level portable-looking `model`; this must fail as a conflict once `model_profile` is recognized, so authors cannot mistake `model` for part of alias resolution.

When only one target is active, the profile needs only that target's definition. For example, a Codex-only repo may define `profiles.models.review.codex` without `claude`. If both targets are active, missing active target definitions fail instead of silently falling back to another provider's model value or to target defaults.

Diagnostics should name the source path, alias, enabled target, and missing or unsupported field:

```text
skillset: .skillset/src/agents/reviewer.md uses model_profile "review", but profiles.models.review.codex is missing and codex is enabled
```

## Interaction With Existing Defaults

Profiles are not a replacement for target defaults. Use exact target defaults when the desired value is already target-native and stable:

```yaml
defaults:
  codex:
    agents:
      model: codex-default-model
      model_reasoning_effort: medium
```

Use `profiles.models` when the author wants one portable intent name that maps to different target-native choices. Profiles fill omitted file-level target fields before target defaults, so an explicit profile on an agent is stronger than a generic root default.

Do not support profile selection from `defaults` in the first implementation slice. A future branch can add `defaults.<target>.agents.model_profile` or a portable default-profile surface only after it proves the precedence is easy to explain. Keeping the first slice file-level avoids turning aliases into another provider-selection surface.

## Implementation Decision

No part of this workflow graduates into implementation in SET-30.

This ADR defines a future source contract and diagnostics so later work can implement the smallest safe slice: project-agent-only `model_profile` resolution. Parser changes, schema updates, generated-output tests, import behavior, and generated skill documentation should wait for that implementation issue.

## Consequences

### Positive

- Gives authors a future way to name model intent once while preserving target-native values.
- Keeps the v1 warning for top-level `model` honest; aliases use an explicit `model_profile` key.
- Gives project agents a narrow proving ground before aliases spread to skills or other surfaces.
- Preserves file-level target overrides and existing target defaults.

### Tradeoffs

- Adds a new root namespace and another source key.
- Authors must still maintain target-specific model values inside each profile.
- The first implementation stays intentionally narrow, so skills and default profile selection remain manual until later.

### Risks

- Model names and reasoning controls drift quickly. Mitigation: profiles store author-controlled strings and target-native fields; implementation should validate shape, not hard-code provider model inventories.
- A profile name like `fast` may imply performance claims. Mitigation: Skillset treats names as repo-local intent labels, not global semantics.
- Profiles could become bags of unrelated settings. Mitigation: model profiles are limited to model and reasoning fields; broader execution profiles require a separate ADR.

## Non-Decisions

- Whether skills should support `model_profile`.
- Whether root or plugin defaults can select a profile.
- Whether aliases should ever include temperature, tool policy, permissions, system prompts, or settings.
- Whether Skillset should ship built-in profile names.
- Whether generated output should record the profile name as metadata in addition to target-native fields.

## References

- [ADR-0000: Source-First Loadouts](../0000-source-first-loadouts.md) - source-first and target-native doctrine.
- [ADR-0001: Root Compile Policy](../0001-root-compile-policy.md) - provider selection and target-specific config boundaries.
- [Agent / Subagent Source Model](../0006-agent-source-model.md) - project agents as the first close-match surface.
- [Feature Reference and Schema Registry](../0005-feature-reference-and-schema-registry.md) - tracks model/reasoning aliases as future-only.
- [Tenets](../../tenets.md) - target truth beats fake portability, and defaults should be scoped.
- [Target Surface Evidence Matrix](../../target-surfaces.md) - current target defaults and top-level model warning rows.
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) - official Claude agent model and effort fields.
- [Codex custom agents](https://developers.openai.com/codex/subagents) - official Codex custom-agent model and reasoning-effort fields.

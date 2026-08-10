---
description: Choose and validate metadata for Skillset skills, agents, and instructions.
---

# Frontmatter

Markdown [source units](../glossary.md#source-unit) use YAML frontmatter for metadata that affects validation and [rendering](../glossary.md#render). Put shared intent in common fields and use a provider block only for a real provider-specific difference.

| Source type | Conventional path | Exact contract | Behavior |
| --- | --- | --- | --- |
| Skill | `.skillset/skills/<skill>/SKILL.md` | [Schema and example](../reference/schemas/README.md) | [Skills](../reference/features/skills.md) |
| Project agent | `.skillset/agents/<agent>.md` | [Schema and example](../reference/schemas/README.md) | [Agents](../reference/features/agents.md) |
| Instruction | `.skillset/rules/**/*.md` | [Schema and example](../reference/schemas/README.md) | [Instructions](../reference/source/instructions.md) |

## Start with Shared Metadata

A skill can begin with a small shared definition:

```yaml
---
name: docs-review
description: Review documentation for accuracy and navigation.
tools: readonly
---
```

Use top-level fields for the source type's portable meaning. The nested `skillset` block carries Skillset source metadata such as schema, preprocessing, origin, version baselines, and licensing. Compatibility requirements belong under `supports`.

The field sets differ by source type. For example, skills can declare resources and tool intent, agents can declare skills and an initial prompt, and instructions can declare path scoping and a dialect. Use the generated [frontmatter schemas and examples](../reference/schemas/README.md) rather than copying a field list from prose.

## Let Paths Supply Identity

Directory names supply machine identity when the source layout already makes it unambiguous. A skill's directory is its skill id, and a plugin's directory is its plugin id. Do not repeat an id under a second key merely for emphasis.

Skills use the standard top-level `name` and `version` fields when those values are required. Root and plugin source metadata may use `skillset.name`; an explicit plugin name must agree with its directory. Retired forms such as `skillset.id` and skill-local `skillset.name` fail instead of creating competing identities.

## Apply Inheritance Deliberately

Shared metadata participates in the configuration [cascade](../glossary.md#cascade). [Workspace](../glossary.md#workspace) defaults fill omitted values, plugin defaults refine their descendants, file fields refine the source unit, and provider fields take precedence for their [target](../glossary.md#target). See [target overrides](target-overrides.md) before adding a provider block.

Licensing follows the same local-first model. A scope can declare `skillset.license`, inherit its parent license, or use `license: none` to opt out. A same-scope `LICENSE.txt` is also source, but it cannot conflict with an explicit opt-out.

## Keep Specialized Syntax with Its Owner

- Configure tool intent through [tools policy](tools-policy.md).
- Learn body expressions and opt-out behavior in [preprocessing](../reference/source/preprocessing.md).
- Use the relevant [feature reference](../reference/features/README.md) for target rendering and diagnostics.

Scaffold new source with [`skillset new`](../reference/cli/new.md), then validate it with [`skillset check`](../reference/cli/check.md).

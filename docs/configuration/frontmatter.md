---
description: Choose and validate metadata for Skillset skills, agents, and rules.
---

# Frontmatter

Markdown [source units](../glossary.md#source-unit) use YAML frontmatter for metadata that affects validation and [rendering](../glossary.md#render). Put shared intent in common fields and use a provider block only for a real provider-specific difference.

| Source type | Conventional path | Exact contract | Behavior |
| --- | --- | --- | --- |
| Skill | `.skillset/skills/<skill>/SKILL.md` | [Schema and example](../reference/schemas/README.md) | [Skills](../reference/features/skills.md) |
| Project agent | `.skillset/subagents/<agent>.md` | [Schema and example](../reference/schemas/README.md) | [Agents](../reference/features/agents.md) |
| Rule | `.skillset/rules/**/*.md` | [Schema and example](../reference/schemas/README.md) | [Rules](../reference/features/rules.md) |

## Start with Shared Metadata

A skill can begin with a small shared definition:

```yaml
---
name: docs-review
description: Review documentation for accuracy and navigation.
tools: readonly
---
```

Use top-level fields for the source type's portable meaning. The nested `skillset` block carries Skillset source metadata such as schema, preprocessing, origin, version baselines, and licensing. Declare machine-checked package, tool, or version requirements under [`supports`](../reference/features/supports.md). That is separate from the Agent Skills `compatibility` field, a short free-text note about the environment a skill needs.

The field sets differ by source type. For example, skills can declare resources and tool intent, agents can declare skills and an initial prompt, and rules can declare path scoping and a dialect. Use the generated [frontmatter schemas and examples](../reference/schemas/README.md) rather than copying a field list from prose.

## Let Paths Supply Identity

Directory names supply machine identity when the source layout already makes it unambiguous. A skill's directory is its skill id, and a plugin's directory is its plugin id. Do not repeat an id under a second key merely for emphasis.

Skills use the standard top-level `name` and `version` fields when those values are required. Root and plugin source metadata may use `skillset.name`; an explicit plugin name must agree with its directory. Retired forms such as `skillset.id` and skill-local `skillset.name` fail instead of creating competing identities.

## Apply Inheritance Deliberately

Shared metadata participates in the configuration [cascade](../glossary.md#cascade). [Workspace](../glossary.md#workspace) defaults fill omitted values, plugin defaults refine their descendants, file fields refine the source unit, and provider fields take precedence for their [target](../glossary.md#target). See [target overrides](target-overrides.md) before adding a provider block.

Licensing follows the same local-first model. A scope can declare `skillset.license`, inherit its parent license, or set `skillset.license: none` to opt out. A top-level `license: none` is not the opt-out; Skillset reads licensing only from the `skillset` block. A same-scope `LICENSE.txt` is also source, but it cannot conflict with an explicit opt-out.

## Keep Specialized Syntax with Its Owner

- Configure tool intent through [tools policy](tools-policy.md).
- Learn body expressions and opt-out behavior in [preprocessing](../reference/source/preprocessing.md).
- Use the relevant [feature reference](../reference/features/README.md) for target rendering and diagnostics.

Scaffold new source with [`skillset new`](../reference/cli/new.md), then validate it with [`skillset check`](../reference/cli/check.md).

## Review Imported Fields

An explicit provider origin scopes imported native and unrecognized fields under that provider's `frontmatter` block. This preserves source attribution; it does not prove cross-provider equivalence. Shared plugin output rejects a field that another selected provider's own projection does not reproduce.

When source provenance cannot establish an owner, import preserves the original top-level keys and values and adds `skillset.unresolved_frontmatter`, a nonempty list of keys requiring a decision. These sources cannot render, including with `compile.unsupportedDestination: warn` or `force`. Import records sidecar review findings in `.skillset/adopt/state.json`; repository adoption combines them with body findings. Direct-import JSON also exposes the field observations and ledger writes.

Resolve the field's meaning and source boundary before removing the source marker. An unresolved ledger decision continues to block projection after marker removal, and accepting uncertainty alone does not establish destination support. Review state and source boundaries are separate: neither deletion of metadata nor a successful import is proof of a faithful migration. If recording findings fails after source import, the preserved source retains its rendering block and the command reports a partial import.

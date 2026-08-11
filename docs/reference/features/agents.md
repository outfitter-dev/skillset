---
description: Agents define project roles, skill references, provider output, compatibility limits, and validation.
---

# Agents

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-agents` | `implemented` | `pass_through` | `unsupported` | `pass_through` |
| `project-agents` | `implemented` | `native` | `transformed` | `native` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Skillset has two agent contracts:

| Kind | Source | Portability |
| --- | --- | --- |
| Project agent | `.skillset/agents/*.md` | Portable [source unit](../../glossary.md#source-unit) rendered for enabled providers |
| Plugin agent | `.skillset/plugins/<plugin>/agents/**/*.md` | [Provider-native](../../glossary.md#provider-native) Claude and Cursor companion; unsupported in Codex plugins |

Project agents define reusable project-scoped roles. Plugin agents remain plugin components because the providers do not share one plugin-agent contract.

## Project-Agent Contract

A project agent is Markdown with YAML frontmatter and a non-empty body. `description` is required. `name` defaults to the filename stem and is sanitized into the generated filename.

```markdown
---
name: release-reviewer
description: Reviews release evidence and generated changes.
skills:
  - changelog
codex:
  model: gpt-5.1-codex
---

Review the proposed release before changing source.
```

The generated [agent-frontmatter schema and example](../schemas/README.md) own all accepted fields. Shared metadata belongs at the top level; provider-only fields belong in `claude`, `codex`, or `cursor` blocks. The [frontmatter](../../configuration/frontmatter.md) and [target override](../../configuration/target-overrides.md) pages explain that [cascade](../../glossary.md#cascade).

Shared `skills` entries are managed references. They must resolve to a target-enabled standalone skill or use `plugin.<plugin>.skill:<skill>`. A provider-installed skill outside the Skillset graph must use an explicit provider-scoped entry:

```yaml
claude:
  skills:
    - native: trails
```

Native references preserve the authored name and order but are not validated, installed, or claimed by Skillset.

## Provider Output

| Source | Claude | Codex | Cursor |
| --- | --- | --- | --- |
| Project agent | `.claude/agents/<name>.md` | `.codex/agents/<name>.toml` | `.cursor/agents/<name>.md` |
| Plugin agent | plugin `agents/` | unsupported | plugin `agents/` |

Claude and Cursor receive native project-agent fields. Codex receives TOML with `name`, `description`, and `developer_instructions`; shared skills become a deterministic instruction preface. That preface is a compatibility shim, not target-enforced skill metadata. `codex.defaults.agents.skillsPrefaceTemplate` configures it.

`initialPrompt` is appended to Codex instructions inside an `<initial_prompt>` block. A source value containing the closing tag is rejected. Resolve-only references can point from project-agent prose back to committed [workspace](../../glossary.md#workspace) files, but project agents do not copy resource bundles.

## Errors and Caveats

Skillset rejects missing descriptions, empty bodies, duplicate or invalid resolved names, unresolved or target-disabled managed skills, invalid qualified references, and unsafe initial-prompt content. A top-level `model` warns unless every enabled [target](../../glossary.md#target) resolves an explicit provider model.

A Codex-enabled plugin containing plugin agents fails instead of dropping or promoting them. Move a portable project role to `.skillset/agents/`, or disable Codex for that plugin. Skillset never writes user-global agent directories during build.

## Provenance

The root `skillset.lock` records source path, resolved name, target path, hashes, validation, and ordered skill-reference ownership. [`skillset explain`](../cli/explain.md) distinguishes managed references from provider-native ones and exposes the Codex shim caveat.

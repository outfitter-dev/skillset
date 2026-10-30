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

The `.skillset/subagents/` directory contains project-agent role source. It is unrelated to the Agent Instructions, Agent Skills, and Agent Plugins standards family, and it is not a standards selector. Likewise, `defaults.<provider>.agents` configures only that provider's project-agent rendering.

Skillset has two project-role contracts:

| Kind | Source | Portability |
| --- | --- | --- |
| Project agent | `.skillset/subagents/*.md` | Portable [source unit](../../glossary.md#source-unit) rendered for enabled providers |
| Plugin agent | `.skillset/plugins/<plugin>/subagents/**/*.md` | [Provider-native](../../glossary.md#provider-native) Claude and Cursor companion; unsupported in Codex plugins |

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

Managed Claude references must also be eligible for [skill preloading](https://code.claude.com/docs/en/sub-agents#preload-skills-into-subagents). Skillset rejects a reference when the skill's effective `disable-model-invocation` is true, including native frontmatter overrides; it does not change the skill's policy or silently drop the reference. Plugin references use the effective Claude manifest name and generated skill directory ID, including portable and native manifest-name overrides. A skill's display name does not replace that directory identity. These checks cover generated configuration; plugin installation, organization policy and runtime discovery remain outside the build's authority.

## Provider Output

| Source | Claude | Codex | Cursor |
| --- | --- | --- | --- |
| Project agent | `.claude/agents/<name>.md` | `.codex/agents/<name>.toml` | `.cursor/agents/<name>.md` |
| Plugin agent | plugin source `subagents/` → bundle `agents/` | unsupported | plugin source `subagents/` → bundle `agents/` |

Claude and Cursor receive native project-agent fields. Codex receives TOML with `name`, `description`, and `developer_instructions`; shared skills become a deterministic instruction preface. That preface is a compatibility shim, not target-enforced skill metadata. `codex.defaults.agents.skillsPrefaceTemplate` configures it.

`initialPrompt` is appended to Codex instructions inside an `<initial_prompt>` block. A source value containing the closing tag is rejected. Resolve-only references can point from project-agent prose back to committed [workspace](../../glossary.md#workspace) files, but project agents do not copy resource bundles.

## Errors and Caveats

Skillset rejects missing descriptions, empty bodies, duplicate or invalid resolved names, unresolved or target-disabled managed skills, invalid qualified references, and unsafe initial-prompt content. A top-level `model` warns unless every enabled [target](../../glossary.md#target) resolves an explicit provider model.

Plugin agents remain [uncovered](plugins.md#uncovered-components) in Codex and Agent Plugins results without blocking supported Claude or Cursor output. The shared package does not imply those consumers support its agents. Move a portable project role to `.skillset/subagents/` when project-agent rendering is intended. Skillset never writes user-global agent directories during build.

## Provenance

The root `skillset.lock` records source path, resolved name, target path, hashes, validation, and ordered skill-reference ownership. [`skillset explain`](../cli/explain.md) distinguishes managed references from provider-native ones and exposes the Codex shim caveat.

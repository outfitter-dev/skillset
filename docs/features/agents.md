# Agents

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-agents` | `implemented` | `pass_through` | `unsupported` | `pass_through` |
| `project-agents` | `implemented` | `native` | `transformed` | `native` |
<!-- skillset:feature-support:end -->

Feature id: `agents`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Project agents are a portable source surface for reusable, project-scoped specialized roles. Plugin agents remain target-native because Claude documents plugin `agents/` and Codex plugins do not document an equivalent plugin component.

## Authoring

```text
<source-root>/agents/*.md
```

`<source-root>` is `.skillset/`.

The source is Markdown with YAML frontmatter:

```yaml
---
name: Code Reviewer
description: Reviews project changes.
skills:
  - skillset-codex-development
initialPrompt: Start with the smallest complete review.
codex:
  model: gpt-5-codex
claude:
  model: sonnet
---

Review diffs and call out correctness risks.
```

`description` and a non-empty body are required. `name` is optional and defaults to the source filename stem. Outputs use the resolved `name`, sanitized deterministically, not necessarily the source filename:

```text
.claude/agents/<resolved-name>.md
.codex/agents/<resolved-name>.toml
```

The active frontmatter contract is generated from `@skillset/schema`; see [schema reference](../reference/schemas/README.md) and [agent frontmatter examples](../reference/examples/agent-frontmatter.yaml) for the current shared fields, common metadata blocks, `supports`, and provider override blocks. Provider-specific fields remain explicit inside `claude` and `codex` blocks rather than being inferred from portable keys.

Skillset must keep this separate from plugin `agents/` and skill-local Codex `agents/openai.yaml`. Reusing either surface would hide target differences and make project behavior look portable by accident.

## Support Table

| Source or surface | Claude | Codex | Status | Notes |
| --- | --- | --- | --- | --- |
| `<source-root>/agents/*.md` | `.claude/agents/*.md` | `.codex/agents/*.toml` | `portable` / `implemented` | Target-specific validation runs after rendering. |
| `<source-root>/plugins/<plugin>/agents/**/*.md` | plugin `agents/` | none | `target_native` / `implemented` for Claude, `unsupported` for Codex | Claude plugin agents stay plugin-scoped and must not be copied into Codex plugins. |
| skill-local `implicit_invocation` | Claude skill frontmatter | Codex `agents/openai.yaml` policy | `portable` / `implemented` | This is skill policy, not a project or plugin custom agent. |
| skill-local `tools` | Claude allowed/disallowed tool metadata | Codex `.skillset.tools.yaml` metadata | `metadata_only` for Codex | Records portable policy without mutating user-level config. |
| `~/.claude/agents` or `~/.codex/agents` writes | user agents | user agents | `future` | User/global writes require explicit setup/review flows and are not a side effect of build. |

## Target Rendering

Claude project agents are Markdown files with YAML frontmatter under `.claude/agents/`. Shared `name`, `description`, `skills`, `initialPrompt`, target-specific `claude.*` fields, and the Markdown body render into that file. Source-only fields are stripped, and generated Skillset metadata is included unless `compile.skillset.metadata: false` suppresses it.

Codex project agents are standalone TOML files under `.codex/agents/` with `name`, `description`, and `developer_instructions`. Shared `skills` render to a deterministic preface in `developer_instructions`; configure the preface with `codex.defaults.agents.skillsPrefaceTemplate` or root shorthand `defaults.codex.agents.skillsPrefaceTemplate`. Shared `initialPrompt` is appended inside an `<initial_prompt>...</initial_prompt>` block, and source containing `</initial_prompt>` is rejected so generated instructions cannot break the wrapper. Target-specific `codex.*` fields keep exact TOML names, including `developer_instructions` overrides.

The Codex skills preface is a runtime compatibility shim. It is useful and intentional, but it is not the same as Claude's target-enforced agent `skills` metadata. Runtime support records should describe this as `shimmed`, with the mechanism and caveat visible to status, explain, activation tests, and distribution reports.

Claude plugin agents are a separate plugin component. Codex plugin docs do not document plugin agents, so copying Claude plugin agents into Codex output would be fake portability. A Codex-enabled plugin with `agents/` fails loudly; set `codex: false` for that plugin or move project-scoped roles to `<source-root>/agents/`.

## Orchestration Compatibility

Project-agent skill loading is the current orchestration boundary:

- Claude receives native project-agent `skills` metadata in `.claude/agents/*.md`.
- Cursor receives native project-agent Markdown with the shared `skills` field.
- Codex receives a deterministic developer-instruction preface that asks the agent to load the named skills first.

The Codex behavior is intentionally classified as `shimmed`, not native, because it depends on instruction following rather than target-enforced metadata. `skillset test` activation probes can cover both sides of that boundary by selecting the helper skill and project agent together, asserting the generated Claude/Codex files, and retaining manual probe assets that label Codex as `manual-shimmed`.

## Diagnostics

- Duplicate or invalid resolved agent names fail before writing target files.
- Missing `description`, empty bodies, invalid `skills`, and unsafe `initialPrompt` values fail before writing target files.
- Top-level `model` warns unless every enabled target has a target-specific model from `claude.model`, `codex.model`, or target defaults.
- A Codex-enabled plugin with Claude plugin agents fails instead of silently dropping or promoting them.
- User/global agent destinations should require explicit future setup workflow, not normal build.

## Provenance

Project-agent outputs record source path, resolved name, target output path, generated files, validation mode, version, and hashes in the root `skillset.lock`. `skillset list` includes `project-agent` entries, and `skillset explain <source-root>/agents/<name>.md` points from source to the generated provider files.

## Tests and Fixtures

Fixtures cover `<source-root>/agents/*.md` rendering to both `.claude/agents/*.md` and `.codex/agents/*.toml`, explicit names that differ from filenames, initial prompts, skills prefaces, metadata suppression, target overrides, collisions, unsafe closing tags, and Codex plugin-agent unsupported diagnostics.

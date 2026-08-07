# Agents

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-agents` | `implemented` | `pass_through` | `unsupported` | `pass_through` |
| `project-agents` | `implemented` | `native` | `transformed` | `native` |
<!-- skillset:feature-support:end -->

Feature id: `agents`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Project agents are a portable source surface for reusable, project-scoped specialized roles. Plugin agents remain target-native because Claude and Cursor document plugin `agents/` while Codex plugins do not document an equivalent plugin component.

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
cursor:
  model: cursor-fast
---

Review diffs and call out correctness risks.
```

`description` and a non-empty body are required. `name` is optional and defaults to the source filename stem. Outputs use the resolved `name`, sanitized deterministically, not necessarily the source filename:

```text
.claude/agents/<resolved-name>.md
.codex/agents/<resolved-name>.toml
.cursor/agents/<resolved-name>.md
```

The active frontmatter contract is generated from `@skillset/schema`; see [schema reference](../reference/schemas/README.md) and [agent frontmatter examples](../reference/examples/agent-frontmatter.yaml) for the current shared fields, common metadata blocks, `supports`, and provider override blocks. Provider-specific fields remain explicit inside `claude`, `codex`, and `cursor` blocks rather than being inferred from portable keys.

Shared `skills` entries and ordinary string entries in a provider block are managed Skillset references. They must resolve to a target-enabled standalone skill or use the qualified `plugin.<plugin>.skill:<skill>` form. When a provider project agent intentionally references a provider-installed skill that is outside Skillset's source graph, author an explicit target-scoped native entry instead:

```yaml
claude:
  model: fable
  skills:
    - be-clark
    - native: trails
```

`native` is an ownership escape, not a missing-skill bypass. Skillset preserves the exact authored name and ordering for that provider but does not validate, install, import, or claim the referenced skill. It is unavailable in shared top-level `skills`; each use must stay visible inside the owning provider block. Use a qualified plugin reference when Skillset owns the plugin skill, because that keeps target availability validation and provider namespace rendering intact.

Project-agent bodies and initial prompts can use resolve-only references such
as `{{@references/guide.md}}` or `{{@shared:references/guide.md}}`. Skillset
validates the source file and renders a path from each provider's generated
agent document back to the committed `.skillset/` source. Project agents are
not resource bundles, so this does not copy companion files and `plugin:`
references are unavailable.

Skillset must keep this separate from plugin `agents/` and skill-local Codex `agents/openai.yaml`. Reusing either surface would hide target differences and make project behavior look portable by accident.

## Support Table

| Source or surface | Claude | Codex | Cursor | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `<source-root>/agents/*.md` | `.claude/agents/*.md` | `.codex/agents/*.toml` | `.cursor/agents/*.md` | `portable` / `implemented` | Target-specific validation runs after rendering. |
| `<source-root>/plugins/<plugin>/agents/**/*.md` | plugin `agents/` | none | plugin `agents/` | `target_native` / `implemented` for Claude and Cursor; `unsupported` for Codex | Plugin agents stay plugin-scoped and must not be copied into Codex plugins. |
| skill-local `implicit_invocation` | Claude skill frontmatter | Codex `agents/openai.yaml` policy | n/a | `portable` / `implemented` | This is skill policy, not a project or plugin custom agent. |
| skill-local `tools` | Claude allowed/disallowed tool metadata | Codex `.skillset.tools.yaml` metadata | Cursor `.skillset.tools.yaml` metadata | `metadata_only` for Codex and Cursor | Records portable policy without mutating user-level config. |
| user agent writes | `~/.claude/agents` | `~/.codex/agents` | `~/.cursor/agents` | `future` | User/global writes require explicit setup/review flows and are not a side effect of build. |

## Target Rendering

Claude project agents are Markdown files with YAML frontmatter under `.claude/agents/`. Shared `name`, `description`, `skills`, `initialPrompt`, target-specific `claude.*` fields, and the Markdown body render into that file. Source-only fields are stripped, and generated Skillset metadata is included unless `compile.skillset.metadata: false` suppresses it.

Codex project agents are standalone TOML files under `.codex/agents/` with `name`, `description`, and `developer_instructions`. Shared `skills` render to a deterministic preface in `developer_instructions`; configure the preface with `codex.defaults.agents.skillsPrefaceTemplate` or root shorthand `defaults.codex.agents.skillsPrefaceTemplate`. Shared `initialPrompt` is appended inside an `<initial_prompt>...</initial_prompt>` block, and source containing `</initial_prompt>` is rejected so generated instructions cannot break the wrapper. Target-specific `codex.*` fields keep exact TOML names, including `developer_instructions` overrides.

Cursor project agents are Markdown files with Cursor frontmatter under `.cursor/agents/`. Shared `name`, `description`, `skills`, `initialPrompt`, target-specific `cursor.*` fields, and the Markdown body render into that file; Cursor-specific fields remain explicit rather than being inferred from portable keys.

The Codex skills preface is a runtime compatibility shim. It is useful and intentional, but it is not the same as Claude's target-enforced agent `skills` metadata. Runtime support records should describe this as `shimmed`, with the mechanism and caveat visible to status, explain, activation tests, and distribution reports.

Claude and Cursor plugin agents are separate plugin components. Codex plugin docs do not document plugin agents, so copying them into Codex output would be fake portability. A Codex-enabled plugin with `agents/` fails loudly; set `codex: false` for that plugin or move project-scoped roles to `<source-root>/agents/`.

## Orchestration Compatibility

Project-agent skill loading is the current orchestration boundary:

- Claude receives native project-agent `skills` metadata in `.claude/agents/*.md`.
- Cursor receives native project-agent Markdown with the shared `skills` field.
- Codex receives a deterministic developer-instruction preface that asks the agent to load the named skills first.

The Codex behavior is intentionally classified as `shimmed`, not native, because it depends on instruction following rather than target-enforced metadata. `skillset test` activation probes can cover both sides of that boundary by selecting the helper skill and project agent together, asserting generated Claude, Codex, and Cursor files, and retaining manual probe assets that label Codex as `manual-shimmed`.

## Diagnostics

- Duplicate or invalid resolved agent names fail before writing target files.
- Missing `description`, empty bodies, unknown or target-disabled managed `skills`, and unsafe `initialPrompt` values fail before writing target files. Qualified plugin skills use `plugin.<plugin>.skill:<skill>` in source and render to the provider namespace. Provider-native skill references must use the exact target-scoped `{ native: <name> }` form.
- Top-level `model` warns unless every enabled target has a target-specific model from `claude.model`, `codex.model`, `cursor.model`, or target defaults.
- A Codex-enabled plugin with Claude or Cursor plugin agents fails instead of silently dropping or promoting them.
- User/global agent destinations should require explicit future setup workflow, not normal build.

## Provenance

Project-agent outputs record source path, resolved name, target output path, generated files, validation mode, version, hashes, and ordered skill-reference provenance in the root `skillset.lock`. Each reference records `managed` or `provider-native` ownership plus its authored and rendered names. `skillset list` includes `project-agent` entries, and `skillset explain <source-root>/agents/<name>.md` points from source to the generated provider files.

## Tests and Fixtures

Fixtures cover `<source-root>/agents/*.md` rendering to `.claude/agents/*.md`, `.codex/agents/*.toml`, and `.cursor/agents/*.md`, explicit names that differ from filenames, initial prompts, managed and provider-native skill references, skills prefaces, metadata suppression, target overrides, drift, collisions, unsafe closing tags, and Codex plugin-agent unsupported diagnostics.

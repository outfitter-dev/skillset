# Agents

Feature id: `agents`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Project agents are a planned portable source surface for reusable, project-scoped specialized roles. Plugin agents remain target-native because Claude documents plugin `agents/` and Codex plugins do not document an equivalent plugin component.

## Authoring

SET-24 defines the planned portable project-agent source:

```text
.skillset/src/agents/*.md
```

The source is Markdown with YAML frontmatter. Outputs use the resolved `name`, not necessarily the source filename:

```text
.claude/agents/<resolved-name>.md
.codex/agents/<resolved-name>.toml
```

Skillset must keep this separate from plugin `agents/` and skill-local Codex `agents/openai.yaml`. Reusing either surface would hide target differences and make project behavior look portable by accident.

## Support Table

| Source or surface | Claude | Codex | Status | Notes |
| --- | --- | --- | --- | --- |
| `.skillset/src/agents/*.md` | `.claude/agents/*.md` | `.codex/agents/*.toml` | `portable` / `planned` | SET-24 implementation target; target-specific validation required. |
| `.skillset/plugins/<plugin>/agents/**/*.md` | plugin `agents/` | none | `target_native` / `implemented` for Claude, `unsupported` for Codex | Claude plugin agents stay plugin-scoped and must not be copied into Codex plugins. |
| skill-local `implicit_invocation` | Claude skill frontmatter | Codex `agents/openai.yaml` policy | `portable` / `implemented` | This is skill policy, not a project or plugin custom agent. |
| skill-local `tool_intent` | Claude allowed/disallowed tool metadata | Codex `.skillset.tools.yaml` metadata | `metadata_only` for Codex | Records intent without mutating user-level config. |
| `~/.claude/agents` or `~/.codex/agents` writes | user agents | user agents | `future` | User/global writes require explicit setup/review flows and are not a side effect of build. |

## Target Lowering

Claude project agents are Markdown files with YAML frontmatter under `.claude/agents/`. Codex project agents are standalone TOML files under `.codex/agents/` with required `name`, `description`, and `developer_instructions`. The planned portable source must validate both target forms after lowering so preprocessing cannot produce an invalid agent file.

Claude plugin agents are a separate plugin component. Codex plugin docs do not document plugin agents, so copying Claude plugin agents into Codex output would be fake portability. Unsupported plugin-agent lowering should fail loudly unless explicit target scoping or future unsupported-policy provenance says otherwise.

## Diagnostics

- Duplicate or invalid resolved agent names should fail before writing target files.
- Missing target-required fields should fail with target-specific diagnostics.
- A Claude-only plugin agent compiled for Codex should remain unsupported rather than disappearing.
- User/global agent destinations should require explicit future setup workflow, not normal build.

## Provenance

Project-agent outputs should record source path, resolved name, target output path, target support status, hashes, and any skipped target state in `.skillset.lock`. `skillset explain` should eventually point from either target file back to the source agent and show why a target was emitted or skipped.

## Tests and Fixtures

SET-24 should add fixtures for `.skillset/src/agents/*.md` lowering to both `.claude/agents/*.md` and `.codex/agents/*.toml`. Existing tests already pin that Claude plugin `agents/` remains absent from Codex plugin output.

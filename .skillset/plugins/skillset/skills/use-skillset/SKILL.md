---
title: Use Skillset
description: Use the skillset compiler to build, check, lint, and import source skills or plugins.
version: 0.1.0
---

# Use Skillset

Use this skill when a repo has a `.skillset/` source tree or when you need to create one.

## Source Layout

```text
.skillset/
  config.yaml
  skills/
    <skill-name>/
      SKILL.md
  plugins/
    <plugin-name>/
      skillset.yaml
      skills/
```

Root `.skillset/config.yaml` controls target defaults and output roots. Plugin configs use `.skillset/plugins/<plugin-name>/skillset.yaml`. Portable plugin metadata lives under `skillset`; skill source can use top-level `title`, `summary`, `description`, and `version`. Target-specific overrides use top-level `claude` and `codex`.

Skill source can also use normalized policy keys:

```yaml
implicit_invocation:
  claude: false
  codex: false
allowed_tools:
  claude:
    - Read
  codex: false
```

`implicit_invocation` lowers to Claude `disable-model-invocation` and Codex `agents/openai.yaml` `policy.allow_implicit_invocation`. `allowed_tools` lowers to Claude `allowed-tools`; Codex has no confirmed skill-local allowed-tools equivalent, so leave `allowed_tools.codex` unset or set it to `false`.

Use underscore tool escapes for target-native control that does not have a normalized portable key yet:

```yaml
tools:
  _allow:
    claude:
      - Read
    codex:
      mcp:
        linear:
          tools:
            - issues.*
claude:
  tools:
    _allow:
      - "NewClaudeTool(project:*)"
codex:
  tools:
    _deny:
      mcp:
        linear:
          tools:
            - experimental.delete
```

Claude escapes lower to `allowed-tools` and `disallowed-tools`. Codex escapes emit generated `.skillset.tools.yaml` metadata for review and lock provenance; they do not install, trust, or mutate user-level Codex configuration.

## Build And Check

```bash
skillset build --root .
skillset lint --root .
skillset check --root .
```

Generated plugin repos default to `plugins-claude/` and `plugins-codex/`. Standalone generated skills default to `.claude/skills` and `.agents/skills`. Generated roots include `.skillset.lock` files for deterministic provenance.

## Import Existing Source

```bash
skillset import skill /path/to/SKILL.md --root .
skillset import skill /path/to/skill-dir --root . --name custom-name
skillset import plugin /path/to/plugin-dir --root .
```

Imports copy into `.skillset/skills/<name>` or `.skillset/plugins/<name>`. Plugin imports write plugin-local `skillset.yaml`. Imports do not publish, install, symlink, trust, mutate registries, or change user-level config.

## Rules

- Do not use `targets:`.
- Prefer `skillset.name`; use `skillset.id` only as a compatibility alias.
- Do not hand-edit generated outputs as source truth.
- Keep Claude-only dynamic placeholders out of Codex-enabled skills unless a target-safe fallback exists.

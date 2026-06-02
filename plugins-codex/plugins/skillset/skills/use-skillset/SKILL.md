---
description: Guidance for using skillset in a source-first repository.
metadata:
  generated: skillset@0.1.0
  version: 0.1.0
name: use-skillset
---

# Use Skillset

Use this skill when a repo has a `.skillset/` source tree or when you need to
create one.

## Source Layout

```text
.skillset/
  config.yaml
  skills/
    <skill-name>/
      SKILL.md
  plugins/
    <plugin-name>/
      config.yaml
      skills/
```

Root `.skillset/config.yaml` controls target defaults and output roots. Plugin
configs use `.skillset/plugins/<plugin-name>/config.yaml`. Portable metadata
lives under `skillset`; target-specific overrides use top-level `claude` and
`codex`.

## Build And Check

```bash
skillset build --root .
skillset lint --root .
skillset check --root .
```

Generated plugin repos default to `plugins-claude/` and `plugins-codex/`.
Standalone generated skills default to `.claude/skills` and `.agents/skills`.
Generated roots include `.skillset.lock` files for deterministic provenance.

## Import Existing Source

```bash
skillset import skill /path/to/SKILL.md --root .
skillset import skill /path/to/skill-dir --root . --name custom-name
skillset import plugin /path/to/plugin-dir --root .
```

Imports copy into `.skillset/skills/<name>` or `.skillset/plugins/<name>`.
Plugin imports rename `skillset.yaml` to `config.yaml`. Imports do not publish,
install, symlink, trust, mutate registries, or change user-level config.

## Rules

- Do not use `targets:`.
- Prefer `skillset.name`; use `skillset.id` only as a compatibility alias.
- Do not hand-edit generated outputs as source truth.
- Keep Claude-only dynamic placeholders out of Codex-enabled skills unless a
  target-safe fallback exists.

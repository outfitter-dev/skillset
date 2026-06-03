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
  shared/
    assets/
    references/
    scripts/
    templates/
  rules/
    <topic>.md
  skills/
    <skill-name>/
      SKILL.md
  plugins/
    <plugin-name>/
      skillset.yaml
      shared/
        references/
        scripts/
      skills/
```

Root `.skillset/config.yaml` controls target defaults and output roots. Plugin configs use `.skillset/plugins/<plugin-name>/skillset.yaml`. Portable plugin metadata lives under `skillset`; skill source can use top-level `title`, `summary`, `description`, and `version`. Target-specific overrides use top-level `claude` and `codex`.

Use `.skillset/rules/**/*.md` for durable repo instructions:

```yaml
---
paths:
  - docs/**/*.md
---

# Docs Rules

- Keep docs concise and current.
```

Claude rules are generated under `.claude/rules/**/*.md` with `paths` frontmatter preserved. Codex rules are generated as `AGENTS.md` files at derived directories: `docs/**/*.md` writes `docs/AGENTS.md`, while broad globs such as `**/*.ts` scan matching repo files and use the lowest common directory. Multiple rules that land at the same `AGENTS.md` are concatenated. The build refuses to overwrite unmanaged `AGENTS.md` files; move existing guidance into `.skillset/rules` before letting `skillset` own it.

Rule bodies can use `{{skillset.repo_root}}`, `{{skillset.output_dir}}`, and `{{skillset.source_rule}}`. Skillset-owned variables use `{{skillset.lower_snake_case}}` and render per generated file, so a nested `docs/AGENTS.md` can point back to `..` while a root `AGENTS.md` points to `.`. Unknown `skillset.*` variables fail the build.

Use `claude: false` or `codex: false` in rule frontmatter for target-specific opt-outs. `codex: symlink` is not implemented yet because Claude path-scoped rules need YAML frontmatter that Codex would read as instructions through a direct symlink.

Use source-only `resources` frontmatter when a skill needs shared Markdown, scripts, templates, or assets from root `.skillset/shared/` or plugin-local `.skillset/plugins/<plugin-name>/shared/`:

```yaml
resources:
  references:
    - shared:references/common.md
    - plugin:references/plugin.md
  scripts:
    - plugin:scripts/check.sh
  templates:
    - from: shared:templates/report.md
      to: templates/report.md
```

`shared:` resolves under root `.skillset/shared/`; `root:` is accepted as an alias. `plugin:` resolves under the current plugin's `shared/` directory and is not valid for standalone skills. Generated Claude and Codex skills receive declared files beside `SKILL.md`, so references stay skill-root-relative. Markdown links to declared `shared:` or `plugin:` URLs are rewritten to the generated local path, and undeclared shared resource links fail the build. Resource mappings cannot write outside the generated skill, overwrite generated control files, or collide with skill-local files.

Plugin companion paths are target-native. Claude receives `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `assets/`, `scripts/`, and `src/`. Codex receives `hooks.json`, `.mcp.json`, `.app.json`, `assets/`, `scripts/`, and `src/`. Claude `agents/` is not copied into Codex; Codex agent output is experimental until a validated source model exists. Hook files are emitted definitions only and must be JSON objects. Codex hook files are validated against Codex-supported events and synchronous `command` handlers only; prompt handlers, agent handlers, and `async: true` command handlers are parsed but skipped by Codex. `skillset` does not install, trust, or enable hooks in user-level config.

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

Use portable `tools.allow` and `tools.deny` for known tool intent:

```yaml
tools:
  allow:
    read:
      - docs/**
    search: true
    shell:
      - git status
      - prefix:
          - bun
          - run
    web_fetch:
      domains:
        - example.com
    mcp:
      linear:
        tools:
          - issues.*
  deny:
    edit:
      - secrets/**
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

Portable keys are `read`, `search`, `write`, `edit`, `shell`, `web_fetch`, `web_search`, and `mcp`; unknown keys fail lint/build. Portable `allow` / `deny` belongs in the source top-level `tools` block; target-local `claude.tools` and `codex.tools` accept only `_allow` / `_deny` escape keys. Claude lowers portable and `_` entries to `allowed-tools` and `disallowed-tools`. Codex emits generated `.skillset.tools.yaml` metadata for portable and target-native intent; it does not install, trust, or mutate user-level Codex configuration.

## Build And Check

```bash
skillset build --root .
skillset lint --root .
skillset check --root .
```

Generated plugin repos default to `plugins-claude/` and `plugins-codex/`. Standalone generated skills default to `.claude/skills` and `.agents/skills`. Generated roots include `.skillset.lock` files for deterministic provenance.

Version fields must be semantic versions. Plugin `skillset.version` lowers into generated plugin manifests. Skill top-level `version` lowers into generated `metadata.version`; plugin-bound skills fall back to plugin version, and standalone skills fall back to root version. `skillset check` reports version drift when a generated plugin manifest version or skill `metadata.version` is stale. Plugin lock entries include included and skipped skill versions so target-specific skips are visible without changing unrelated generated skill files.

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

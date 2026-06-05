---
title: Use Skillset
description: Use the skillset compiler to build, check, lint, and import source skills or plugins.
version: 0.1.0
skillset:
  preprocess: false
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
  instructions/
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

Root `.skillset/config.yaml` controls provider defaults and output roots. Use `compile.targets` for provider selection, `compile.build: updated | all` for the normalized build mode, `compile.skillset.metadata: false` to suppress generated skill metadata, and `compile.unsupported: error` for fail-loud unsupported lowering. Plugin configs use `.skillset/plugins/<plugin-name>/skillset.yaml`. Portable plugin metadata lives under `skillset`; skill source can use top-level `title`, `summary`, `description`, and `version`. Target-specific adapter config, defaults, and overrides use top-level `claude` and `codex`; root `defaults.<target>.<surface>` is shorthand for target defaults without introducing a bare `targets:` map.

Use `.skillset/instructions/**/*.md` for durable repo instructions (`.skillset/rules/**/*.md` is a compatibility alias that still builds but warns):

```yaml
---
paths:
  - docs/**/*.md
---

# Docs Rules

- Keep docs concise and current.
```

Claude rules are generated under `.claude/rules/**/*.md` with `paths` frontmatter preserved. Codex rules are generated as `AGENTS.md` files at derived directories: `docs/**/*.md` writes `docs/AGENTS.md`, while broad globs such as `**/*.ts` scan matching repo files and use the lowest common directory. Multiple rules that land at the same `AGENTS.md` are concatenated in source order, each preceded by a `<!-- source: ... -->` boundary comment (path only, no frontmatter). Codex truncates `AGENTS.md` beyond `project_doc_max_bytes` (32 KiB default); `skillset` warns when generated output crosses it — split instructions across nested directories or raise the limit. The build refuses to overwrite unmanaged `AGENTS.md` files; move existing guidance into `.skillset/instructions` before letting `skillset` own it.

Skill and rule bodies are preprocessed before target serialization. Use `{{this.<field>}}` for simple current-frontmatter references, `{{> shared:path.md}}` or `{{> plugin:path.md}}` for partials, and `skillset.preprocess: false` when a body should keep literal braces. Rule bodies can also use `{{skillset.repo_root}}`, `{{skillset.output_dir}}`, and `{{skillset.source_rule}}`; these render per generated file, so a nested `docs/AGENTS.md` can point back to `..` while a root `AGENTS.md` points to `.`. Missing `this` fields and unknown Skillset variables fail the build.

Use `claude: false` or `codex: false` in rule frontmatter for target-specific opt-outs. `codex: symlink` is not implemented yet because Claude path-scoped rules need YAML frontmatter that Codex would read as instructions through a direct symlink.

Use target-native islands for explicit provider files that are not portable: `.skillset/src/claude/**` mirrors to `.claude/**`, `.skillset/src/codex/**` mirrors to `.codex/**`, and plugin-local islands under `.skillset/src/plugins/<plugin>/<target>/**` mirror into that generated plugin bundle only. Project islands are workspace-managed files in the root `.skillset.lock`, not ownership claims on the whole `.claude/` or `.codex/` directory. Codex `.rules` are command execution policy and pass through only from `.skillset/src/codex/rules/**/*.rules`; portable instructions never lower to Codex `.rules`. Use `skillset list` or `skillset explain <path>` to inspect generated lock provenance, including target-native islands.

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

Plugin companion paths are target-native. Claude receives `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `themes/`, `monitors/`, `assets/`, `scripts/`, and `src/`, declared in the manifest with their documented fields. Codex receives `hooks/hooks.json`, `.mcp.json`, `.app.json`, `assets/`, `scripts/`, and `src/`. Pass-through paths are copied as opaque content. Claude `agents/` is not copied into Codex; Codex agent output is experimental until a validated source model exists. Hooks are emitted definitions only and must be JSON objects. Both targets emit hooks at the documented `hooks/hooks.json` path with a top-level `hooks` object, sourced from a shared `hooks/hooks.json`; a legacy root `hooks.json` is a Codex compatibility source that still builds but warns. Codex hook files are validated against Codex-supported events and synchronous `command` handlers only; prompt handlers, agent handlers, and `async: true` command handlers are parsed but skipped by Codex. `skillset` does not install, trust, or enable hooks in user-level config.

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

`implicit_invocation` lowers to Claude `disable-model-invocation` and Codex `agents/openai.yaml` `policy.allow_implicit_invocation`. `allowed_tools` lowers to Claude `allowed-tools`, which is preapproval / no-prompt behavior rather than a portable sandbox; Codex has no confirmed skill-local allowed-tools equivalent, so leave `allowed_tools.codex` unset or set it to `false`.

Use portable `tool_intent.allow` and `tool_intent.deny` for known tool intent (the legacy `tools` key is a compatibility alias; setting both fails). The name records intent and metadata, not target-enforced permissions:

```yaml
tool_intent:
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
  tool_intent:
    _allow:
      - "NewClaudeTool(project:*)"
codex:
  tool_intent:
    _deny:
      mcp:
        linear:
          tools:
            - experimental.delete
```

Portable keys are `read`, `search`, `write`, `edit`, `shell`, `web_fetch`, `web_search`, and `mcp`; unknown keys fail lint/build. Portable `allow` / `deny` belongs in the source top-level `tool_intent` block; target-local `claude.tool_intent` and `codex.tool_intent` accept only `_allow` / `_deny` escape keys (the legacy `tools` key is still accepted as an alias). Claude lowers portable and `_` entries to `allowed-tools` and `disallowed-tools` (preapproval, not enforcement). Codex emits generated `.skillset.tools.yaml` metadata for portable and target-native intent; it does not install, trust, or mutate user-level Codex configuration.

## Build And Check

```bash
skillset build --root .
skillset lint --root .
skillset check --root .
skillset diff --root .            # pending generated changes, no writes
skillset explain <path> --root .  # lowering + lock provenance for a source/generated path
skillset doctor --root .          # lint issues + drift + warnings
```

`diff`, `explain`, and `doctor` are read-only authoring aids. They never write generated outputs, install, trust, publish, or mutate user-level config. `doctor` exits non-zero on lint issues, drift, or a build error.

Generated plugin repos default to `plugins-claude/` and `plugins-codex/`. Standalone generated skills default to `.claude/skills` and `.agents/skills`. Generated roots include `.skillset.lock` files for deterministic provenance.

Version fields must be semantic versions. Plugin `skillset.version` lowers into generated plugin manifests. Skill top-level `version` lowers into generated `metadata.version`; plugin-bound skills fall back to plugin version, and standalone skills fall back to root version. `skillset check` reports version drift when a generated plugin manifest version or skill `metadata.version` is stale. Plugin lock entries include included and skipped skill versions so target-specific skips are visible without changing unrelated generated skill files.

## Import Existing Source

```bash
skillset import /path/to/SKILL.md --root .
skillset import /path/to/skill-dir --root .
skillset import /path/to/skills-root --kind skills --root .
skillset import /path/to/plugin-dir --root .
skillset import /path/to/plugins-root --kind plugins --root .
skillset import claude --root .
skillset import codex --root .
skillset import agents --root .
```

`skillset import <path>` infers `skill`, `skills`, `plugin`, or `plugins` from the filesystem. Use `--kind` when a directory is ambiguous. Passing `SKILL.md` imports the full containing skill directory, including sibling `references/`, `scripts/`, `assets/`, `.codex/`, and other sidecars. The provider shortcuts import from `~/.claude/skills`, `~/.codex/skills`, or `~/.agents/skills`; skills-root imports de-dupe symlinked skill directories by real path. Plugin imports write plugin-local `skillset.yaml`, synthesizing a minimal one when importing a native generated plugin that only has `.claude-plugin/plugin.json` or `.codex-plugin/plugin.json`. Imports do not publish, install, symlink, trust, mutate registries, or change user-level config.

## Rules

- Use root `compile.targets` for provider selection. Do not use bare top-level `targets:`.
- Keep target adapter config in `claude` / `codex`; use `defaults.<target>` only as shorthand for target defaults.
- Use `claude.model`, `codex.model`, or target defaults for model choices; top-level skill `model` warns in v1.
- Keep `compile.unsupported` on `error`; `warn`, `skip`, and `force` are reserved until provenance exists.
- Prefer `skillset.name`; use `skillset.id` only as a compatibility alias.
- Do not hand-edit generated outputs as source truth.
- Keep Claude-only dynamic placeholders out of Codex-enabled skills unless a target-safe fallback exists.

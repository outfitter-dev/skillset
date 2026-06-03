# Layout

`skillset` expects content repositories to separate portable source from generated target outputs:

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
    <area>/
      <topic>.md
  skills/
    <skill-name>/
      SKILL.md
      references/
      agents/
        openai.yaml
  plugins/
    <plugin-name>/
      skillset.yaml
      README.md
      shared/
        assets/
        references/
        scripts/
        templates/
      skills/
        <skill-name>/
          SKILL.md
          references/
          agents/
            openai.yaml
      commands/
      agents/
      hooks/
      assets/
      scripts/
plugins-claude/
  .skillset.lock
  README.md
  .claude-plugin/
    marketplace.json
  plugins/
    <plugin-name>/
      .claude-plugin/
        plugin.json
      skills/
plugins-codex/
  .skillset.lock
  README.md
  plugins/
    <plugin-name>/
      .codex-plugin/
        plugin.json
      skills/
.claude/
  rules/
    .skillset.lock
    <topic>.md
  skills/
    .skillset.lock
    <skill-name>/
      SKILL.md
.agents/
  skills/
    .skillset.lock
    <skill-name>/
      SKILL.md
      agents/
        openai.yaml
AGENTS.md
<subdir>/
  AGENTS.md
.skillset.lock
```

The generated target roots are meant to be usable as plugin repositories or as inputs to a future publish/sync step. They are not source truth.

This compiler repo uses that same layout for its own source:

- `.skillset/skills/skillset-claude-development` is a Claude-only internal standalone skill for compiler development.
- `.skillset/skills/skillset-codex-development` is a Codex-only internal standalone skill for compiler development.
- `.skillset/plugins/skillset` is the user-facing plugin that explains how to use `skillset`.

Plugin output roots and standalone skill output roots can be enabled with defaults or configured from root `.skillset/config.yaml`:

```yaml
claude:
  plugins: true
  skills: true

codex:
  plugins:
    - skillset
  skills:
    path: .agents/skills
```

Boolean output settings use the default roots: `plugins-claude/`, `plugins-codex/`, `.claude/skills`, and `.agents/skills`. Arrays select specific plugin or standalone skill names. Object settings can set `path`, `include`, or `enabled: false`.

Plugin-local `README.md` files are copied into each generated target plugin. Shared source inputs such as `.skillset/shared/assets`, `.skillset/shared/scripts`, `.skillset/shared/references`, `.skillset/shared/templates`, and plugin-local `.skillset/plugins/<plugin-name>/shared/` are available for source organization; they are not copied into every output unless a source skill declares them.

## Shared Resources

Skill-local supporting files already work when they sit beside `SKILL.md`, for example `references/`, `scripts/`, `assets/`, and `templates/`. Use shared resources when several skills need the same file but generated Claude and Codex output still needs skill-root-relative paths:

```yaml
resources:
  references:
    - shared:references/common.md
    - plugin:references/plugin.md
  scripts:
    - plugin:scripts/check.sh
  assets:
    - shared:assets/icon.png
  templates:
    - from: shared:templates/report.md
      to: templates/report.md
```

`shared:` resolves under root `.skillset/shared/`; `root:` is a compatibility alias for the same location. `plugin:` resolves under `.skillset/plugins/<plugin-name>/shared/` and is valid only for plugin-bound skills. Group keys choose the default generated folder, so `resources.scripts: [plugin:scripts/check.sh]` emits `scripts/check.sh` beside the generated `SKILL.md`. Use `from` / `to` objects when a resource should land at a different generated path.

Only declared resources are copied. Resource mappings may point at files or directories, but they cannot traverse outside the shared root, write outside the generated skill directory, or overwrite `SKILL.md`, generated Codex sidecars, or skill-local files. Markdown links in `SKILL.md` that target declared `shared:` or `plugin:` resource URLs are rewritten to generated skill-local links; undeclared shared resource links fail the build. Resource contents are included in `.skillset.lock` hashes and stale-output checks.

## Versioning

Root `skillset.version`, plugin `skillset.version`, skill top-level `version`, and compatibility skill `skillset.version` fields must be semantic versions.

Generated plugin manifests receive the plugin version. Generated `SKILL.md` files receive:

```yaml
metadata:
  version: 0.1.0
  generated: skillset@0.1.0
```

Each `.skillset.lock` records emitted versions and hashes. Plugin lock entries also include `includedSkills`, `skippedSkills`, and `targetState`; a target with skipped source skills uses `targetState: intentionally-skipped` so target-specific version bumps are visible even when that target's manifest and skills stay byte-for-byte unchanged. `skillset check` reports version drift directly when generated plugin manifest `version` or generated skill `metadata.version` is stale.

## Rules

Rules live under `.skillset/rules/**/*.md`. They are for durable repo instructions rather than invokable skills:

```yaml
---
paths:
  - docs/**/*.md
---

# Docs Rules

- Keep docs concise and current.
```

Claude output preserves the relative source hierarchy under `.claude/rules/**/*.md` and keeps `paths` frontmatter so Claude can apply path-scoped rules. Rules without `paths` are emitted without frontmatter and load as unconditional Claude project rules.

Codex output lowers rules into the instruction files Codex actually discovers. Rules without `paths` write root `AGENTS.md`. Rules with path patterns write `<derived-base>/AGENTS.md`; for example `docs/**/*.md` writes `docs/AGENTS.md`. If a pattern has no static base, such as `**/*.ts`, the compiler scans matching repo files and uses the lowest common directory for the matched files. Multiple rules that land at the same `AGENTS.md` are concatenated in source-path order.

Rule markdown bodies support Skillset build-time variables. `{{skillset.repo_root}}` becomes the relative path from the generated file directory back to the repository root, or `.` at the root. `{{skillset.output_dir}}` becomes the generated file directory relative to the repository root, or `.` at the root. `{{skillset.source_rule}}` becomes the source rule path. Skillset-owned variables use `{{skillset.lower_snake_case}}`, render independently for each generated Claude rule and Codex `AGENTS.md` file, and unknown `skillset.*` variables fail the build. Target-native variables in target-native config files are left to that target.

Rule frontmatter can use top-level `claude` and `codex` target toggles. Set `codex: false` for a Claude-only rule or `claude: false` for a Codex-only rule. Generated Codex `AGENTS.md` files are tracked by the root `.skillset.lock`, and the build refuses to overwrite unmanaged `AGENTS.md` files. Move existing hand-written guidance into `.skillset/rules` before letting the compiler own that destination.

`codex: symlink` is a recorded follow-up, not a v1 behavior. Directly symlinking Codex `AGENTS.md` to Claude rule files would expose Claude `paths` frontmatter as Codex instructions.

## Target-Specific Plugin Surfaces

Some plugin companion paths are target-native rather than portable. Claude output copies `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `assets/`, `scripts/`, and `src/` when present. Codex output copies `hooks.json`, `.mcp.json`, `.app.json`, `assets/`, `scripts/`, and `src/`. Claude `agents/` is not copied into Codex output; Codex agent output remains an experimental boundary until a validated source model exists.

Hooks are generated definitions only. The compiler does not install, trust, or enable hooks in user-level configuration. Hook files must be JSON objects before they are emitted. Claude uses `hooks/hooks.json`; Codex uses root `hooks.json`. The compiler does not auto-lower Claude hooks into Codex hooks.

## Skill Policy

Skill frontmatter can express normalized policy once and let the compiler lower it into target-native files:

```yaml
implicit_invocation: false
allowed_tools:
  claude:
    - Read
    - Grep
  codex: false
```

Values can be shared (`implicit_invocation: false`) or target-scoped (`implicit_invocation: { claude: false, codex: true }`). `implicit_invocation` lowers to Claude `disable-model-invocation` and Codex `agents/openai.yaml` `policy.allow_implicit_invocation`. If a Codex source skill already has `agents/openai.yaml`, generated policy is merged into it instead of overwriting the rest of the file.

`allowed_tools` lowers to Claude `allowed-tools`. Codex `agents/openai.yaml` supports tool dependencies and invocation policy, but it is not a skill-local equivalent to Claude tool preapproval. For now Codex-enabled skills must leave `allowed_tools.codex` unset or set it to `false`; `skillset lint` rejects shared or Codex-targeted allowed tools until a real Codex permission lowering is validated.

Use the portable `tools` registry for known tool intent. The registry is strict, so provider drift is visible instead of silently copied through:

```yaml
tools:
  allow:
    read:
      - docs/**
    search: true
    write:
      - generated/**
    shell:
      - git status
      - prefix:
          - bun
          - run
    web_fetch:
      domains:
        - example.com
    web_search: true
    mcp:
      linear:
        tools:
          - issues.*
  deny:
    edit:
      - secrets/**
    mcp:
      linear:
        tools:
          - delete.*
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
      - rule: "Bash(newcli safe *)"
    _deny:
      - AskUserQuestion
codex:
  tools:
    _allow:
      mcp:
        linear:
          tools:
            - experimental.*
```

Portable keys are `read`, `search`, `write`, `edit`, `shell`, `web_fetch`, `web_search`, and `mcp`. Unknown keys fail `skillset lint` and build; use `_allow` or `_deny` when a target has a native tool rule that the portable registry does not know yet. Portable `allow` / `deny` belongs in the source top-level `tools` block; target-local `claude.tools` and `codex.tools` accept only `_allow` / `_deny` escape keys. Claude lowers portable and `_` entries to `allowed-tools` / `disallowed-tools`. Codex preserves portable intent and target-native escapes as generated `.skillset.tools.yaml` metadata included in `.skillset.lock`; it does not install, trust, or mutate user-level Codex configuration.

Import helpers write only to `.skillset/`:

```bash
skillset import skill /path/to/SKILL.md --root .
skillset import plugin /path/to/plugin-dir --root .
```

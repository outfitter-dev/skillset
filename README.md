# Skillset

`skillset` compiles portable agent plugin and skill source into target-native Claude and Codex outputs.

It is currently local/private tooling for `galligan/agents`.

This repo also self-hosts a small `.skillset/` source tree:

- standalone internal skills for developing the compiler in Claude and Codex;
- one generated `skillset` plugin that teaches agents how to use the compiler.

## Docs

- [Skillset Design Tenets](docs/tenets.md): the slow-moving doctrine for source-first loadout authoring and target-native lowering.
- [Skillset Docs](docs/README.md): the docs map.
- [Layout](docs/layout.md): the current source layout, output shape, and compiler behavior reference.

## Usage

From a content repo:

```bash
skillset build
skillset lint
skillset check
```

The default contract is:

- source root: `.skillset/`
- root config: `.skillset/config.yaml`
- plugin source: `.skillset/plugins/<plugin-name>/`
- standalone skill source: `.skillset/skills/<skill-name>/`
- instruction rule source: `.skillset/rules/**/*.md`
- Claude plugin repo output: `plugins-claude/`
- Codex plugin repo output: `plugins-codex/`
- Claude standalone skill output: `.claude/skills`
- Codex standalone skill output: `.agents/skills`
- Claude rule output: `.claude/rules`
- Codex rule output: `AGENTS.md` files at derived repo directories

Use explicit paths when building another repo:

```bash
skillset build --root /Users/mg/Developer/galligan/agents
skillset check --root /Users/mg/Developer/galligan/agents
skillset build --root /tmp/example --source custom-source --dist generated
```

`--dist` is a compatibility override for plugin outputs. Without it, plugin outputs default to `plugins-claude/` and `plugins-codex/`. Source config can also set explicit output roots in target output objects such as `claude.plugins.path` or `codex.skills.path`.

## Import

Seed source from an existing skill or plugin:

```bash
skillset import skill /path/to/SKILL.md --root /path/to/content-repo
skillset import skill /path/to/skill-dir --root /path/to/content-repo --name custom-name
skillset import plugin /path/to/plugin-dir --root /path/to/content-repo
```

Imports copy files into `.skillset/skills/<name>` or `.skillset/plugins/<name>`. Plugin imports write plugin-local `skillset.yaml`. Import does not install, trust, symlink, publish, mutate registries, or change user-level Claude/Codex config.

## Source Contract

Root source metadata lives at `.skillset/config.yaml`.

Each plugin lives at `.skillset/plugins/<plugin-name>/` and has its own `skillset.yaml`. Portable plugin fields live under `skillset`; target-specific overrides live under top-level `claude` and `codex` blocks. Skill source frontmatter can use top-level `title`, `summary`, `description`, `version`, `resources`, `implicit_invocation`, `allowed_tools`, and the source-only `tools` escape map; the compiler derives target-native `name`, `description`, generated metadata, Claude frontmatter, Codex `agents/openai.yaml` policy where supported, and skill-local copies of declared resources.

Use `skillset.name` as the stable machine identity. `skillset.id` is accepted as a compatibility alias for older source. Do not use `targets:`.

Generated output strips source-only keys such as `skillset`, `claude`, `codex`, `agents`, `resources`, `implicit_invocation`, `allowed_tools`, `tools`, and `targets`. Generated skills receive only lightweight metadata:

```yaml
metadata:
  version: 0.1.0
  generated: skillset@0.1.0
```

Generated roots also receive `.skillset.lock` files with deterministic provenance and hashes.

## Shared Resources

Use `.skillset/shared/` for root shared inputs and `.skillset/plugins/<plugin-name>/shared/` for plugin-local shared inputs. Shared inputs are not copied wholesale. A skill opts into exact files or directories with source-only `resources` frontmatter:

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

`shared:` points at `.skillset/shared/`; `root:` is accepted as an alias. `plugin:` points at `.skillset/plugins/<plugin-name>/shared/` and is valid only for plugin-bound skills. Grouped resources default to skill-local target paths such as `references/common.md`, `scripts/check.sh`, `assets/...`, or `templates/...`; use `from` / `to` when the output path should differ.

Generated Claude and Codex skills receive the copied files beside `SKILL.md`, so links and script references stay skill-root-relative. Markdown links that use declared `shared:` or `plugin:` resource URLs are rewritten to the generated skill-local path; undeclared shared resource links fail the build. When a resource uses a custom `to`, a bare (schemeless) link to the resource's source path is ambiguous and fails the build with a diagnostic: link to the emitted target path or use the `shared:`/`plugin:` resource URL instead. Resource mappings cannot write outside the generated skill directory or overwrite `SKILL.md`, generated Codex sidecars, or skill-local files. Resource contents participate in `.skillset.lock` hashes and `skillset check`.

`skillset.schema` marks the source-contract schema and is separate from content versions. It is an optional integer (currently `1`) on root and plugin config that defaults to the current schema when absent; future or non-integer values fail the build. Source `skillset.version` and skill `version` fields must be semantic versions. `skillset check` reports explicit version drift when a generated plugin manifest or skill `metadata.version` is stale.

Plugin lock entries include the emitted plugin version plus `includedSkills`, `skippedSkills`, and `targetState`. When a target-specific skill version bump does not affect the other target's generated skill or manifest, that target's lock can still explain the intentionally skipped source version.

Portable skill policy can be shared or targeted:

```yaml
implicit_invocation:
  claude: false
  codex: false
allowed_tools:
  claude:
    - Read
    - Grep
  codex: false
```

`implicit_invocation` lowers to Claude `disable-model-invocation` and Codex `agents/openai.yaml` `policy.allow_implicit_invocation`. `allowed_tools` lowers to Claude `allowed-tools`; Codex has no confirmed skill-local allowed-tools equivalent, so Codex-enabled source must omit `allowed_tools.codex` or set it to `false`.

Target-native tool escape hatches use underscore keys. Shared escapes can live under top-level `tools`, and target-local escapes can live under `claude.tools` or `codex.tools`:

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
      - rule: "Bash(newcli safe *)"
codex:
  tools:
    _deny:
      mcp:
        linear:
          tools:
            - experimental.delete
```

Portable `tools.allow` and `tools.deny` accept only known keys: `read`, `search`, `write`, `edit`, `shell`, `web_fetch`, `web_search`, and `mcp`. Unknown keys fail lint/build. Portable `allow` / `deny` belongs in the source top-level `tools` block; target-local `claude.tools` and `codex.tools` accept only `_allow` / `_deny` escape keys. Claude lowers portable entries to `allowed-tools` and `disallowed-tools`; Codex preserves portable intent in generated `.skillset.tools.yaml` metadata until a validated skill-local permission surface exists. Claude `_allow` and `_deny` entries lower to native rules too. Codex `_allow` and `_deny` entries emit to `.skillset.tools.yaml` under `target_native`, so they are committed, locked, and reviewable without changing user-level Codex policy or trust configuration.

## Rules

Use `.skillset/rules/**/*.md` for repo instructions that should become Claude rules and Codex `AGENTS.md` files:

```yaml
---
paths:
  - docs/**/*.md
---

# Docs Rules

- Keep docs concise and current.
```

The compiler preserves the source hierarchy when writing Claude rules, so `.skillset/rules/docs/writing.md` becomes `.claude/rules/docs/writing.md`. `paths` frontmatter is kept for Claude and stripped from Codex output.

For Codex, `skillset` derives the nearest useful `AGENTS.md` destination from each path pattern. `docs/**/*.md` writes `docs/AGENTS.md`; `**/*.ts` scans matching repo files and writes to the lowest common directory, such as `src/AGENTS.md` when matching TypeScript files live under `src/`. Multiple source rules that land at the same destination are concatenated deterministically.

Rule bodies can use Skillset build-time variables when prose needs target-correct paths:

```md
- Run checks from {{skillset.repo_root}}.
- This generated instruction file lives under {{skillset.output_dir}}.
- Source rule: {{skillset.source_rule}}.
```

`{{skillset.repo_root}}` renders as the relative path from the generated file directory back to the repository root, or `.` at the root. `{{skillset.output_dir}}` renders as the generated file directory relative to the repository root, or `.` at the root. `{{skillset.source_rule}}` renders as the source rule path. Unknown `skillset.*` variables fail the build.

Skillset-owned variables use `{{skillset.lower_snake_case}}` to match the source YAML naming style. Target-native variables such as Claude `$ARGUMENTS` and `${CLAUDE_*}` remain target-specific and are not rendered by the rule variable layer.

Rule target toggles use the same top-level target keys:

```yaml
---
paths:
  - docs/**/*.md
claude: true
codex: false
---
```

Generated Codex `AGENTS.md` files are tracked by the root `.skillset.lock`. The build refuses to overwrite an unmanaged `AGENTS.md`, so existing hand-written guidance stays protected until it is moved into `.skillset/rules` or removed deliberately.

`codex: symlink` is intentionally not implemented yet. Path-scoped Claude rules need YAML `paths` frontmatter, and a direct symlink would expose that control block to Codex as instructions.

## Target-Specific Plugin Surfaces

Plugin companion directories are target-native. Claude receives `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `assets/`, `scripts/`, and `src/` when those source paths exist. Codex receives `hooks.json`, `.mcp.json`, `.app.json`, `assets/`, `scripts/`, and `src/`; Claude `agents/` is not copied into Codex output. Codex agent output remains an experimental boundary until a validated Codex agent source model is added.

Hook files are emitted as definitions only. `skillset` does not install, trust, or enable hooks in user-level Claude/Codex config. Emitted hook files must be target-native JSON objects: Claude uses `hooks/hooks.json`, while Codex uses root `hooks.json`. The compiler does not auto-lower Claude hooks into Codex hooks.

Hook definitions are checked for target compatibility. Codex hook files must use Codex-supported events — `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SubagentStart`, `SubagentStop`, `UserPromptSubmit`, `Stop` — and synchronous `command` handlers only, because Codex parses but skips prompt handlers, agent handlers, and `async: true` command handlers. Unsupported Codex events or skipped handler forms fail both `skillset build` and `skillset lint`. Claude hook validation stays broad (JSON-object shape) because Claude's hook surface is wider and still evolving.

## Self-Hosted Outputs

In this repo, run:

```bash
bun run skillset:build
bun run skillset:lint
bun run skillset:check
bun run check
```

Self-hosted source lives under `.skillset/`. Generated outputs are:

- `.claude/skills/skillset-claude-development`
- `.agents/skills/skillset-codex-development`
- `.claude/rules` when source rules exist
- `plugins-claude/plugins/skillset`
- `plugins-codex/plugins/skillset`

These are repo-local generated artifacts. Do not symlink them into global Claude/Codex config or publish them as part of normal compiler development.

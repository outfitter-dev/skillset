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
  instructions/
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
  src/
    agents/
      <agent-name>.md
    claude/
      ...
    codex/
      ...
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
  agents/
    <agent-name>.md
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
.codex/
  agents/
    <agent-name>.toml
<subdir>/
  AGENTS.md
.skillset.lock
```

The generated target roots are meant to be usable as plugin repositories or as inputs to a future publish/sync step. They are not source truth.

This compiler repo uses that same layout for its own source:

- `.skillset/skills/skillset-claude-development` is a Claude-only internal standalone skill for compiler development.
- `.skillset/skills/skillset-codex-development` is a Codex-only internal standalone skill for compiler development.
- `.skillset/plugins/skillset` is the user-facing plugin that explains how to use `skillset`.

## Setup Commands

`skillset init` initializes source in an existing repo or directory. It plans by default, writes only with `--yes`, and refuses to overwrite existing setup files with different content. The minimal scaffold is `.skillset/config.yaml` plus `.skillset/src/.gitkeep`; requested flags can add `.skillset/instructions/project.md`, `.skillset/src/agents/`, `.skillset/src/claude/`, and `.skillset/src/codex/rules/` placeholders. The project-doc scaffold is a real portable instruction source that lowers to Claude rules and Codex `AGENTS.md`.

`skillset create` creates a new source repo, defaulting to `my-skillset` under the current directory. `skillset create --global` defaults the source checkout to `~/.skillset/src`. This global source path and the documented `~/.skillset/build` preview/build area are Skillset-owned locations, not live target runtime directories. Setup does not create or mutate `~/.claude`, `~/.codex`, `.agents`, marketplaces, trust settings, or symlinks.

The generated setup config uses `compile.targets` for provider selection. Target-native adapter settings still belong in `claude` and `codex` blocks, and reusable defaults belong in `defaults.<target>.<surface>` or the target-local `defaults` block. Package-manager bootstraps such as `npx create-skillset` and `bunx create-skillset` are intended to invoke the same `create` flow once publishing exists; this package remains private while the source contract is settling.

Provider selection, plugin output roots, and standalone skill output roots can be enabled with defaults or configured from root `.skillset/config.yaml`:

```yaml
compile:
  targets:
    - claude
    - codex
  build: updated
  skillset:
    metadata: true
  unsupported: error
```

Omitting `compile.targets` builds every supported provider projection for portable source. `compile.build` defaults to `updated` and accepts `all`; CLI `--updated` and `--all` override the config for one command, and the resolved mode is recorded in lock provenance. `updated` writes missing or changed generated files and removes stale scoped generated files while leaving unchanged files untouched; `all` rewrites selected output roots. `skillset build` is plan-first and writes only with `--yes`; `--dry-run` always prevents writes. `compile.skillset.metadata` defaults to `true`; set it to `false` to suppress Skillset's generated `metadata.generated` and `metadata.version` fields in emitted skills. `compile.unsupported` defaults to `error`; `warn`, `skip`, and `force` are reserved until unsupported-source warnings and lock provenance exist.

The canonical provider-selection shape is the `compile.targets` list above. This shorthand normalizes to the same internal target plan:

```yaml
compile:
  targets: [claude, codex]
```

When `compile.targets` is omitted, Skillset normalizes to all supported providers. Target-specific `claude` and `codex` blocks configure native output details and lower-level opt-outs; they are not a second target-selection surface.

Provider blocks carry target-native adapter configuration, output settings, defaults, and lower-level opt-outs:

```yaml
defaults:
  codex:
    skills:
      model: gpt-5

claude:
  projectRoot: .claude
  userRoot: ~/.claude
  defaults:
    skills:
      model: sonnet
  plugins: true
  skills: true

codex:
  projectRoot: .codex
  userRoot: ~/.codex
  plugins:
    - skillset
  skills:
    path: .agents/skills
```

Boolean output settings use the default roots: `plugins-claude/`, `plugins-codex/`, `.claude/skills`, and `.agents/skills`. Arrays select specific plugin or standalone skill names. Object settings can set `path`, `include`, or `enabled: false`. When `compile.targets` is present, a root provider object without `enabled` inherits the compile target set, so output-path objects do not accidentally re-enable a provider. Lower-level plugin, skill, and instruction objects keep the existing opt-in semantics. Do not add a bare top-level `targets:` key; provider selection has one home.

Target defaults use `claude.defaults.<surface>` and `codex.defaults.<surface>` as the canonical target-local form. Root `defaults.<target>.<surface>` is a shorthand that normalizes into the same target defaults without making `targets:` a config surface. Supported surfaces are `agents`, `instructions`, `plugins`, and `skills`; unknown surfaces such as `defaults.codex.skill` fail instead of silently no-oping. Defaults fill omitted target options for that surface: plugin defaults override root defaults, file-level target fields override plugin defaults, and target-specific fields override shared portable fields at render time. For example, a root `codex.defaults.skills.model` applies to Codex-enabled skills unless a plugin or skill provides `codex.model`, and `codex.defaults.agents.skillsPrefaceTemplate` customizes generated Codex project-agent skill prefaces.

A top-level skill `model` looks portable but is not portable in v1. It is stripped from generated output and emits a warning unless every enabled target has an explicit target model from `claude.model`, `codex.model`, or target defaults.

Plugin-local `README.md` files are copied into each generated target plugin. Shared source inputs such as `.skillset/shared/assets`, `.skillset/shared/scripts`, `.skillset/shared/references`, `.skillset/shared/templates`, and plugin-local `.skillset/plugins/<plugin-name>/shared/` are available for source organization; they are not copied into every output unless a source skill declares them.

## Source Identity

Machine identity derives from directory names. A plugin's id is its directory under `.skillset/plugins/`, and a skill's id is its directory under `skills/`. Authors should not repeat the directory name in source unless derivation is wrong.

When an explicit identity is needed:

- **Plugins and root config** keep their explicit identity under the `skillset` block, because that is where plugin/root source metadata lives (`schema`, `version`, presentation, author). Set `skillset.name`; `skillset.id` is a compatibility alias. An explicit plugin `skillset.name` must equal the plugin directory name, so derivation and the override never disagree silently.
- **Skills** use the standard Agent Skills top-level `name`. `skillset.name` / `skillset.id` remain compatibility aliases for imported source.

Conflicting identity keys fail the build rather than resolving silently: `skillset.name` versus `skillset.id`, or a skill's top-level `name` versus its `skillset.name`/`skillset.id`. There is no separate top-level `name` for plugins; introducing one would give a single meaning two homes.

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

Only declared resources are copied. Resource mappings may point at files or directories, but they cannot traverse outside the shared root, write outside the generated skill directory, or overwrite `SKILL.md`, generated Codex sidecars, or skill-local files. Markdown links in `SKILL.md` that target declared `shared:` or `plugin:` resource URLs are rewritten to generated skill-local links; undeclared shared resource links fail the build with a suggested `resources` entry. When a resource uses a custom `to`, a bare link to its source path fails the build, since that path is no longer where the resource lands; link to the emitted target path or use the resource URL. Resource contents are included in `.skillset.lock` hashes and stale-output checks.

`skillset lint` adds authoring diagnostics that catch these earlier:

- `resource-undeclared-link`: a `SKILL.md` markdown link to a `shared:`/`plugin:` resource that is not declared, reported with a suggested `resources` entry.
- `skill-plugin-root-script`: a skill body that links to a plugin-root script path (`${CLAUDE_PLUGIN_ROOT}`/`${PLUGIN_ROOT}`, or a `../` link escaping the skill to a script). Skills should copy scripts skill-local via `resources.scripts` and reference `./scripts/<name>` so the script travels with the generated skill.
- `resource-script-not-executable`: a declared `scripts/` resource whose source file is missing an executable bit. The build copies file contents but not modes, so the source must already be executable; `skillset` reports the gap rather than `chmod`-ing generated output (it does not install or run scripts).

## Source schema

`skillset.schema` marks the version of the source contract a config was authored against. It is separate from every content version: `skillset.version` is the plugin/root content version, generated skill `metadata.version` is the artifact version, and each lock's `schemaVersion` is the generated-output provenance schema.

`skillset.schema` is an integer. The current supported schema is `1`. It is optional and defaults to the current schema when absent, so existing source keeps building. A future or non-integer value fails the build, and a semver-style value is rejected so it cannot be confused with `skillset.version`:

```yaml
skillset:
  schema: 1        # source contract schema (integer, optional)
  version: 0.2.0   # content version (semver)
```

Root and plugin source config support `skillset.schema`. The marker is source-only and never appears in generated artifacts; deeper provenance lives in `.skillset.lock`.

## Versioning

Root `skillset.version`, plugin `skillset.version`, skill top-level `version`, and compatibility skill `skillset.version` fields must be semantic versions.

Generated plugin manifests receive the plugin version. Generated `SKILL.md` files receive:

```yaml
metadata:
  version: 0.1.0
  generated: skillset@0.1.0
```

Each `.skillset.lock` records emitted versions and hashes, plus root normalized build metadata such as `buildMode`, `selectedTargets`, and whether generated Skillset skill metadata was emitted. Plugin lock entries also include `includedSkills`, `skippedSkills`, and `targetState`; a target with skipped source skills uses `targetState: intentionally-skipped` so target-specific version bumps are visible even when that target's manifest and skills stay byte-for-byte unchanged. `skillset check` reports version drift directly when generated plugin manifest `version` or generated skill `metadata.version` is stale.

## Instructions

Instructions live under `.skillset/instructions/**/*.md`. They are for durable repo instructions rather than invokable skills. `.skillset/rules/**/*.md` is a compatibility alias for migration and import: it still builds and produces byte-identical output, but emits a deprecation warning, and the build fails if both `instructions/` and `rules/` carry content. Internally and in generated output these are still called rules, because Claude's native target is `.claude/rules`.

```yaml
---
paths:
  - docs/**/*.md
---

# Docs Rules

- Keep docs concise and current.
```

Claude output preserves the relative source hierarchy under `.claude/rules/**/*.md` and keeps `paths` frontmatter so Claude can apply path-scoped rules. Rules without `paths` are emitted without frontmatter and load as unconditional Claude project rules.

Codex output lowers rules into the instruction files Codex actually discovers. Rules without `paths` write root `AGENTS.md`. Rules with path patterns write `<derived-base>/AGENTS.md`; for example `docs/**/*.md` writes `docs/AGENTS.md`. If a pattern has no static base, such as `**/*.ts`, the compiler scans matching repo files and uses the lowest common directory for the matched files. Multiple rules that land at the same `AGENTS.md` are concatenated in source-path order, each preceded by a deterministic `<!-- source: .skillset/instructions/<path> -->` boundary comment that names the source instruction. Boundary comments carry the path only; source-only frontmatter (such as `paths`) never reaches the generated `AGENTS.md`. Skillset does not write `.codex/AGENTS.md` as a default project-instruction location; Codex project guidance belongs in `AGENTS.md` files at the repo root or scoped directories.

Codex truncates each `AGENTS.md` beyond `project_doc_max_bytes` (32 KiB by default) silently. When a generated `AGENTS.md` crosses that size, `skillset build`/`check` warns. To stay under the limit, split instructions across nested directories so they lower to scoped `AGENTS.md` files (which load only when working in that subtree), or raise `project_doc_max_bytes` in Codex config.

Skill and instruction Markdown bodies use Skillset preprocessing before target serialization. `{{this.<field>}}` reads a simple string field from the current document's shared frontmatter; missing fields fail with the source path and field name. Instructions also support `{{skillset.repo_root}}`, `{{skillset.output_dir}}`, and `{{skillset.source_rule}}`; these render independently for each generated Claude rule and Codex `AGENTS.md` file. Partials use `{{> shared:path.md}}`, `{{> plugin:path.md}}`, or a file path relative to the current source file. Set `skillset.preprocess: false` in source frontmatter when a Markdown body should keep literal braces; the control is stripped from generated output.

Instruction frontmatter can use top-level `claude` and `codex` target toggles. Set `codex: false` for a Claude-only instruction or `claude: false` for a Codex-only instruction. Generated Codex `AGENTS.md` files are tracked by the root `.skillset.lock`, and the build refuses to overwrite unmanaged `AGENTS.md` files. Move existing hand-written guidance into `.skillset/instructions` before letting the compiler own that destination.

`codex: symlink` is a recorded follow-up, not a v1 behavior. Directly symlinking Codex `AGENTS.md` to Claude rule files would expose Claude `paths` frontmatter as Codex instructions.

Codex `.rules` files are not instruction Markdown. They are target-native command execution policy files under Codex config-layer `rules/` directories. Target-native islands mirror `.skillset/src/codex/rules/**/*.rules` into `.codex/rules/**/*.rules`, but portable prose instructions continue to lower through `AGENTS.md`.

## Target-Specific Source and Plugin Surfaces

Portable project agents live under `.skillset/src/agents/*.md`. They lower to Claude `.claude/agents/<resolved-name>.md` and Codex `.codex/agents/<resolved-name>.toml`, using the resolved `name` when present and otherwise the source filename stem. Agent source requires `description` plus a body, supports shared `skills` and `initialPrompt`, and keeps target-native fields under `claude` and `codex` blocks. Codex `skills` become a deterministic `developer_instructions` preface, and `initialPrompt` is wrapped in `<initial_prompt>...</initial_prompt>` with closing-tag input rejected. Project-agent files are tracked in the root `.skillset.lock`; `skillset list` and `skillset explain` expose their provenance.

Project target-native islands mirror explicit target source to target project roots: `.skillset/src/claude/**` writes to `.claude/**` by default, and `.skillset/src/codex/**` writes to `.codex/**` by default. `claude.projectRoot` and `codex.projectRoot` can override those roots. Codex `.rules` pass through only from `.skillset/src/codex/rules/**/*.rules` to `.codex/rules/**/*.rules`; portable prose instructions never lower to Codex command policy.

Some plugin companion paths are target-native rather than portable. Claude output copies `commands/`, `agents/`, `hooks/hooks.json`, `.lsp.json`, `output-styles/`, `themes/`, `monitors/`, `assets/`, `scripts/`, and `src/` when present. Codex output copies `hooks/hooks.json`, `.app.json`, `assets/`, `scripts/`, and `src/`. Plugin-local islands under `.skillset/src/plugins/<plugin>/claude/**` and `.skillset/src/plugins/<plugin>/codex/**` mirror into the matching generated plugin bundle only. Codex plugin `.rules` remains unsupported. Current generated JSON, YAML, Markdown, TOML utility output, and lock files are parsed after generation; copied unknown files and binary sidecars are not parsed as text.

MCP server definitions and Claude plugin `bin/` use feature-key source pointers rather than the generic companion copier. Conventional plugin-local `.mcp.json` and `bin/` are discovered unless disabled with `mcp: false` or `bin: false`; explicit `mcp.source` and `bin.source` values must use `repo:<path>` pointers inside the repo and outside configured generated output roots. MCP sources must be JSON files and are validated after generation; `bin` sources must be directories and are copied only to Claude plugin output. Because Codex plugins do not support `bin` in v1, a Codex-enabled plugin with enabled `bin` fails loudly unless the plugin or Codex plugin output selection opts out.

When a Claude pass-through path is present, the generated `.claude-plugin/plugin.json` declares it using the documented manifest field: `mcpServers` for `.mcp.json`, `lspServers` for `.lsp.json`, `outputStyles` for `output-styles/`, and the experimental `experimental.themes` / `experimental.monitors` for `themes/` and `monitors/monitors.json`. Codex plugin manifests declare MCP with `mcpServers` when `.mcp.json` is enabled. The supported Claude plugin component paths were live-doc verified against `code.claude.com/docs/en/plugins` and `code.claude.com/docs/en/plugins-reference` (2026-06-04).

Claude plugin docs now document root `bin/` and plugin-root `settings.json`. Treat both as target-native, not portable. `bin/` is a documented executable component and can be supported through feature-key/source-pointer work. Plugin-root `settings.json` applies default configuration when a Claude plugin is enabled, so Skillset must keep it separate from live user/project settings mutation. Build still emits definitions only: it does not install, trust, enable, or symlink generated output into runtime locations. A reviewed settings suggestion workflow is a future non-goal for v1.

Hooks are generated definitions only. The compiler does not install, trust, or enable hooks in user-level configuration. Hook files must be JSON objects before they are emitted. Both Claude and Codex emit hooks at the documented default `hooks/hooks.json` with a top-level `{ "hooks": { ... } }` object. The canonical source is `hooks/hooks.json`; when it is the only hook file it is shared by both targets. A legacy root `hooks.json` is an explicit Codex-specific compatibility source: when it is present it is used for Codex even if a canonical `hooks/hooks.json` also exists, so the two-file layout can intentionally carry different Claude and Codex hooks during migration. It still builds — flat event maps are normalized into the canonical `hooks` object and emitted to `hooks/hooks.json` — but the build warns and recommends moving it under `hooks/`. The compiler does not auto-lower Claude hooks into Codex hooks. Codex hook files are validated against Codex-supported events and synchronous `command` handlers only; prompt handlers, agent handlers, and `async: true` command handlers are parsed but skipped by Codex, so target-incompatible Codex hooks fail `skillset build` and `skillset lint`. Claude hook validation stays broad.

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

`allowed_tools` lowers to Claude `allowed-tools`, which is preapproval / no-prompt behavior — it suppresses permission prompts for the listed tools, not a portable security sandbox. Codex `agents/openai.yaml` supports tool dependencies and invocation policy, but it is not a skill-local equivalent to Claude tool preapproval. For now Codex-enabled skills must leave `allowed_tools.codex` unset or set it to `false`; `skillset lint` rejects shared or Codex-targeted allowed tools until a real Codex permission lowering is validated.

Use the portable `tool_intent` registry for known tool intent (the legacy `tools` key is a compatibility alias; setting both fails). The name is deliberate: it records intent and metadata, not a target-enforced permission boundary. The registry is strict, so provider drift is visible instead of silently copied through:

```yaml
tool_intent:
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
  tool_intent:
    _allow:
      - "NewClaudeTool(project:*)"
      - rule: "Bash(newcli safe *)"
    _deny:
      - AskUserQuestion
codex:
  tool_intent:
    _allow:
      mcp:
        linear:
          tools:
            - experimental.*
```

Portable keys are `read`, `search`, `write`, `edit`, `shell`, `web_fetch`, `web_search`, and `mcp`. Unknown keys fail `skillset lint` and build; use `_allow` or `_deny` when a target has a native tool rule that the portable registry does not know yet. Portable `allow` / `deny` belongs in the source top-level `tool_intent` block; target-local `claude.tool_intent` and `codex.tool_intent` accept only `_allow` / `_deny` escape keys. The legacy `tools` key remains a compatibility alias at both levels. Claude lowers portable and `_` entries to `allowed-tools` / `disallowed-tools` (preapproval, not enforcement). Codex preserves portable intent and target-native escapes as generated `.skillset.tools.yaml` metadata included in `.skillset.lock`; it does not install, trust, or mutate user-level Codex configuration.

Import helpers write only to `.skillset/`:

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

`skillset import <path>` infers `skill`, `skills`, `plugin`, or `plugins` from the filesystem when it can. Use `--kind skill`, `--kind skills`, `--kind plugin`, or `--kind plugins` when a directory is ambiguous. `--kind skills` means a root whose child directories each contain a `SKILL.md`; this covers user-global skill roots such as `~/.claude/skills`, `~/.codex/skills`, and `~/.agents/skills`. The provider shortcuts above pick those roots directly. The older compatibility form `skillset import skill <path>` and `skillset import plugin <path>` still works.

Skill imports always copy the full skill directory. If the input path is the `SKILL.md` file itself, the import root becomes its parent directory so sibling `references/`, `scripts/`, `assets/`, `agents/`, `.codex/`, and other sidecars are preserved. Skills-root imports follow symlinked skill directories but de-dupe by real path to avoid importing the same global skill twice through shared roots.

Plugin imports accept source plugins with `skillset.yaml` / `config.yaml`, native Claude generated plugin directories with `.claude-plugin/plugin.json`, native Codex generated plugin directories with `.codex-plugin/plugin.json`, and plugin repositories whose plugins live under a child `plugins/` directory. Native generated plugin imports preserve the native manifest files and synthesize a minimal source `skillset.yaml` when no source config exists.

`importSource` returns an `ImportReport` (also printed by the CLI) with: `copiedFiles`, `inferredSourceFields` (frontmatter keys Skillset recognizes as source), `preservedTargetNativeFields` (Claude/Codex-native keys kept verbatim, such as `allowed-tools`, `disallowed-tools`, `disable-model-invocation`, `model`, `argument-hint`), `unsupportedFields` (unrecognized keys kept verbatim), `warnings`, and `nextChecks`. Import preserves all frontmatter — target-native and unknown keys pass through unchanged — and the report tells you what to review and migrate, so import is a bridge rather than a lossy copier. Import never overwrites an existing source; there is no overwrite mode yet.

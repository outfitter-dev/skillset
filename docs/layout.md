# Layout

`skillset` expects content repositories to separate portable source from generated target outputs:

```text
.skillset/
  skillset.yaml
  src/
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
        _claude/
        _codex/
    hooks/
    agents/
      <agent-name>.md
    _claude/
      ...
    _codex/
      ...
  changes/
  build/
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

Ordinary repos use `.skillset/skillset.yaml` as the workspace manifest and `.skillset/src/` as the adaptive source root. Dedicated Skillset repos use root `skillset.yaml` as the workspace manifest and root `skillset/` as the adaptive source root. Generated target roots are meant to be usable as plugin repositories or as inputs to a future publish/sync step. They are not source truth.

This compiler repo uses that same layout for its own source:

- `.skillset/src/skills/skillset-claude-development` is a Claude-only internal standalone skill for compiler development.
- `.skillset/src/skills/skillset-codex-development` is a Codex-only internal standalone skill for compiler development.
- `.skillset/src/plugins/skillset` is the user-facing plugin that explains how to use `skillset`.

## Setup Commands

`skillset init` initializes source in an existing repo or directory. It plans by default, writes only with `--yes`, resolves the Git root by default, and validates existing workspace manifests instead of replacing them with generated stubs. In an empty ordinary repo, the scaffold is `.skillset/skillset.yaml`, root `.skillset/src/.gitkeep`, placeholders for `.skillset/src/agents`, `.skillset/src/hooks`, `.skillset/src/plugins`, `.skillset/src/rules`, `.skillset/src/shared`, `.skillset/src/skills`, `.skillset/src/_claude`, and `.skillset/src/_codex`, tracked `.skillset/changes/.gitkeep`, ignored `.skillset/build/.gitkeep`, and `.skillset/.gitignore` for build scratch. If root `skillset.yaml` or `skillset/` already exists, `init` treats the repo as a dedicated Skillset repo: it validates root `skillset.yaml`, scaffolds missing `skillset/` source-family placeholders, and writes tracked `changes/.gitkeep` without creating `.skillset/skillset.yaml`. `--include ci` adds a user-owned `.github/workflows/skillset-ci.yml` workflow. Init also performs repo-local adoption: it detects unmanaged repo-local Claude/Codex/Skillset artifacts, skips generated output roots with Skillset locks, and seeds release-state baselines from current versions and normalized source hashes without creating pending changes, history entries, releases, or changelog renderings.

`skillset create` creates a new dedicated Skillset source repo, defaulting to `my-skillset` under the current directory. Local create writes root `skillset.yaml`, root `skillset/` source-family placeholders, root `changes/.gitkeep`, root `skillset.lock`, a `.gitignore` that ignores `.skillset/` operational output, a README, lightweight `AGENTS.md` guidance, and a Git repository by default. `skillset create --global` defaults the source checkout to `~/.skillset/src` and stays source-only: it writes root `skillset.yaml`, root `skillset/` placeholders, and root `changes/.gitkeep` inside that checkout without creating a Git repo, repo-local guidance, or live runtime config. This global source path and the documented `~/.skillset/build` preview/build area are Skillset-owned locations, not live target runtime directories. Setup does not create or mutate `~/.claude`, `~/.codex`, `.agents`, marketplaces, trust settings, or symlinks. Future create work can add starter source templates and reviewed Claude/Codex configuration suggestions without writing live runtime settings.

The generated setup config uses `compile.targets` for provider selection. Target-native adapter settings still belong in `claude` and `codex` blocks, and reusable defaults belong in `defaults.<target>.<surface>` or the target-local `defaults` block. The published package requires Bun and ships Bun-built JavaScript bins for `skillset` and `create-skillset`; stable releases run from the default npm dist-tag with commands such as `npx skillset create` or `bunx skillset create`. Prerelease builds remain available through their explicit tag, such as `skillset@beta`. Setup still routes through the same plan-first `create` flow.

Provider selection, plugin output roots, and standalone skill output roots can be enabled with defaults or configured from the workspace manifest, `.skillset/skillset.yaml` in ordinary repos or root `skillset.yaml` in dedicated repos:

```yaml
compile:
  targets:
    - claude
    - codex
  build: updated
  skillset:
    metadata: true
  unsupportedDestination: error
```

Omitting `compile.targets` builds every supported provider rendering for portable source. `compile.build` defaults to `updated` and accepts `all`; CLI `--updated` and `--all` override the config for one command, and the resolved mode is recorded in lock provenance. `updated` writes missing or changed generated files and removes stale scoped generated files while leaving unchanged files untouched; `all` rewrites selected generated files and removes stale managed files, but it does not delete whole output roots or claim unmanaged neighbors. `skillset build` is plan-first and writes only with `--yes`; `--dry-run` always prevents writes. Confirmed builds back up unmanaged collisions and target-side edits under `.skillset/build/backups/<backup-id>/` before replacing or deleting them, and `skillset restore <backup-id>` previews recovery before writing with `--yes`. `compile.skillset.metadata` defaults to `true`; set it to `false` to suppress Skillset's generated `metadata.generated` and `metadata.version` fields in rendered skills. `compile.unsupportedDestination` defaults to `error`, which gates unsupported, lossy, and failed render from structured render results before writes; `warn`, `skip`, and `force` are reserved until their non-error semantics are implemented and documented.

The canonical provider-selection shape is the `compile.targets` list above. This shorthand normalizes to the same internal target plan:

```yaml
compile:
  targets: [claude, codex]
```

When `compile.targets` is omitted, Skillset normalizes to all supported providers. Target-specific `claude` and `codex` blocks configure native output details and provider-specific opt-outs; they are not a second target-selection surface.

Provider blocks carry target-native adapter configuration, output settings, defaults, and provider-specific opt-outs:

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

Plugin-local `README.md` files are copied into each generated target plugin. Shared source inputs such as `<source-root>/shared/assets`, `<source-root>/shared/scripts`, `<source-root>/shared/references`, `<source-root>/shared/templates`, and plugin-local `<source-root>/plugins/<plugin-name>/shared/` are available for source organization; they are not copied into every output unless a source skill declares them.

## Source Identity

Machine identity derives from directory names. A plugin's id is its directory under `<source-root>/plugins/`, and a skill's id is its directory under `skills/`. Authors should not repeat the directory name in source unless derivation is wrong.

When an explicit identity is needed:

- **Plugins and the root source manifest** keep their explicit identity under the `skillset` block, because that is where plugin/root source metadata lives (`schema`, `version`, presentation, author). Set `skillset.name` only when derivation is wrong. An explicit plugin `skillset.name` must equal the plugin directory name, so derivation and the override never disagree silently.
- **Skills** use the standard Agent Skills top-level `name` and `version`.

Obsolete identity keys fail the build rather than resolving silently: `skillset.id` is unsupported, and skill-local `skillset.name` / `skillset.id` are not used. There is no separate top-level `name` for plugins; introducing one would give a single meaning two homes.

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

`shared:` resolves under root `<source-root>/shared/`. `plugin:` resolves under `<source-root>/plugins/<plugin-name>/shared/` and is valid only for plugin-bound skills. Group keys choose the default generated folder, so `resources.scripts: [plugin:scripts/check.sh]` emits `scripts/check.sh` beside the generated `SKILL.md`. Use `from` / `to` objects when a resource should land at a different generated path.

Only declared resources are copied. Resource mappings may point at files or directories, but they cannot traverse outside the shared root, write outside the generated skill directory, or overwrite `SKILL.md`, generated Codex sidecars, or skill-local files. Markdown links in `SKILL.md` that target declared `shared:` or `plugin:` resource URLs are rewritten to generated skill-local links; undeclared shared resource links fail the build with a suggested `resources` entry. When a resource uses a custom `to`, a bare link to its source path fails the build, since that path is no longer where the resource lands; link to the rendered target path or use the resource URL. Resource contents are included in `.skillset.lock` hashes and stale-output checks.

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

Root `skillset.version`, plugin `skillset.version`, and skill top-level `version` fields must be semantic versions. Skill-local `skillset.version` is unsupported; use the top-level skill `version`.

Generated plugin manifests receive the plugin version. Generated `SKILL.md` files receive:

```yaml
metadata:
  version: 0.1.0
  generated: skillset@0.1.0
```

Each `.skillset.lock` records rendered versions and hashes, plus root normalized build metadata such as `buildMode`, `selectedTargets`, and whether generated Skillset skill metadata was rendered. Locks also carry `renderResults` for the source units represented by that lock, using the `skillset-render-result@1` schema so rendered, transformed, target-native, degraded, skipped, unsupported, and failed render facts survive beyond console output. Plugin lock entries include `includedSkills`, `skippedSkills`, and `targetState`; a target with skipped source skills uses `targetState: intentionally-skipped` so target-specific version bumps are visible even when that target's manifest and skills stay byte-for-byte unchanged. `skillset check` reports version drift directly when generated plugin manifest `version` or generated skill `metadata.version` is stale.

## Instructions

Instructions live under `<source-root>/rules/**/*.md`: `.skillset/src/rules/**/*.md` in ordinary repos and `skillset/rules/**/*.md` in dedicated Skillset repos. They are for durable repo instructions rather than invokable skills. `.skillset/rules/**/*.md` is unsupported for instruction Markdown; move those files into the active source root's `rules/` directory. Internally and in generated output these are still called rules, because Claude's native target is `.claude/rules`.

```yaml
---
paths:
  - docs/**/*.md
---

# Docs Rules

- Keep docs concise and current.
```

Claude output preserves the relative source hierarchy under `.claude/rules/**/*.md` and keeps `paths` frontmatter so Claude can apply path-scoped rules. Rules without `paths` are rendered without frontmatter and load as unconditional Claude project rules.

Codex output renders rules into the instruction files Codex actually discovers. Rules without `paths` write root `AGENTS.md`. Rules with path patterns write `<derived-base>/AGENTS.md`; for example `docs/**/*.md` writes `docs/AGENTS.md`. If a pattern has no static base, such as `**/*.ts`, the compiler scans matching repo files and uses the lowest common directory for the matched files. Multiple rules that land at the same `AGENTS.md` are concatenated in source-path order, each preceded by a deterministic `<!-- source: <source-root>/rules/<path> -->` boundary comment that names the source instruction. Boundary comments carry the path only; source-only frontmatter (such as `paths`) never reaches the generated `AGENTS.md`. Skillset does not write `.codex/AGENTS.md` as a default project-instruction location; Codex project guidance belongs in `AGENTS.md` files at the repo root or scoped directories.

Codex truncates each `AGENTS.md` beyond `project_doc_max_bytes` (32 KiB by default) silently. When a generated `AGENTS.md` crosses that size, `skillset build`/`check` warns. To stay under the limit, split instructions across nested directories so they render to scoped `AGENTS.md` files (which load only when working in that subtree), or raise `project_doc_max_bytes` in Codex config.

Skill and instruction Markdown bodies use Skillset preprocessing before target serialization. `{{this.<field>}}` reads a simple string field from the current document's shared frontmatter; missing fields fail with the source path and field name. Instructions also support `{{skillset.repo_root}}`, `{{skillset.output_dir}}`, and `{{skillset.source_rule}}`; these render independently for each generated Claude rule and Codex `AGENTS.md` file. Partials use `{{> shared:path.md}}`, `{{> plugin:path.md}}`, or a file path relative to the current source file. Set `skillset.preprocess: false` in source frontmatter when a Markdown body should keep literal braces; the control is stripped from generated output.

Instruction frontmatter can use top-level `claude` and `codex` target toggles. Set `codex: false` for a Claude-only instruction or `claude: false` for a Codex-only instruction. Generated Codex `AGENTS.md` files are tracked by the root `.skillset.lock`. If a build needs to replace an unmanaged `AGENTS.md`, it first backs up the existing file and warns with the restore id. Move existing hand-written guidance into `<source-root>/rules` when you want the compiler to own that destination long term.

`codex: symlink` is a recorded follow-up, not a v1 behavior. Directly symlinking Codex `AGENTS.md` to Claude rule files would expose Claude `paths` frontmatter as Codex instructions.

Codex `.rules` files are not instruction Markdown. They are target-native command execution policy files under Codex config-layer `rules/` directories. Provider source mirrors `<source-root>/_codex/rules/**/*.rules` into `.codex/rules/**/*.rules`, but portable prose instructions continue to render through `AGENTS.md`.

## Target-Specific Source and Plugin Surfaces

Portable project agents live under `<source-root>/agents/*.md`. They render to Claude `.claude/agents/<resolved-name>.md` and Codex `.codex/agents/<resolved-name>.toml`, using the resolved `name` when present and otherwise the source filename stem. Agent source requires `description` plus a body, supports shared `skills` and `initialPrompt`, and keeps target-native fields under `claude` and `codex` blocks. Codex `skills` become a deterministic `developer_instructions` preface, and `initialPrompt` is wrapped in `<initial_prompt>...</initial_prompt>` with closing-tag input rejected. Project-agent files are tracked in the root `.skillset.lock`; `skillset list` and `skillset explain` expose their provenance.

Provider source mirrors explicit provider files to provider project roots: `<source-root>/_claude/**` writes to `.claude/**` by default, and `<source-root>/_codex/**` writes to `.codex/**` by default. `claude.projectRoot` and `codex.projectRoot` can override those roots. Codex `.rules` pass through only from `<source-root>/_codex/rules/**/*.rules` to `.codex/rules/**/*.rules`; portable prose instructions never render to Codex command policy.

Some plugin companion paths are target-native rather than portable. Claude output copies `commands/`, `agents/`, `hooks/hooks.json`, `.lsp.json`, `output-styles/`, `themes/`, `monitors/`, `assets/`, `scripts/`, and `src/` when present. Codex output copies `hooks/hooks.json`, `.app.json`, `assets/`, `scripts/`, and `src/`. Plugin-local provider source under `<source-root>/plugins/<plugin>/_claude/**` and `<source-root>/plugins/<plugin>/_codex/**` mirrors into the matching generated plugin bundle only. Codex plugin `.rules` remains unsupported. Current generated JSON, YAML, Markdown, TOML utility output, and lock files are parsed after generation; copied unknown files and binary sidecars are not parsed as text.

MCP server definitions and Claude plugin `bin/` use feature-key source pointers rather than the generic companion copier. Conventional plugin-local `.mcp.json` and `bin/` are discovered unless disabled with `mcp: false` or `bin: false`; explicit `mcp.source` and `bin.source` values must use `repo:<path>` pointers inside the repo and outside configured generated output roots. MCP sources must be JSON files and are validated after generation; `bin` sources must be directories and are copied only to Claude plugin output. Because Codex plugins do not support `bin` in v1, a Codex-enabled plugin with enabled `bin` fails loudly unless the plugin or Codex plugin output selection opts out.

When a Claude pass-through path is present, the generated `.claude-plugin/plugin.json` declares it using the documented manifest field: `mcpServers` for `.mcp.json`, `lspServers` for `.lsp.json`, `outputStyles` for `output-styles/`, and the experimental `experimental.themes` / `experimental.monitors` for `themes/` and `monitors/monitors.json`. Codex plugin manifests declare MCP with `mcpServers` when `.mcp.json` is enabled. The supported Claude plugin component paths were live-doc verified against `code.claude.com/docs/en/plugins` and `code.claude.com/docs/en/plugins-reference` (2026-06-04).

Claude plugin docs now document root `bin/` and plugin-root `settings.json`. Treat both as target-native, not portable. `bin/` is a documented executable component and can be supported through feature-key/source-pointer work. Plugin-root `settings.json` applies default configuration when a Claude plugin is enabled, so Skillset must keep it separate from live user/project settings mutation. Build still emits definitions only: it does not install, trust, enable, or symlink generated output into runtime locations. A reviewed settings suggestion workflow is a future non-goal for v1.

Hooks are generated definitions only. The compiler does not install, trust, or enable hooks in user-level configuration. Hook files must be JSON objects before they are rendered. Both Claude and Codex render hooks at the documented default `hooks/hooks.json` with a top-level `{ "hooks": { ... } }` object. The canonical source is `hooks/hooks.json`; it is shared by both targets when both are enabled. Plugin-root `hooks.json` is unsupported and fails with a move-to-`hooks/hooks.json` diagnostic. The compiler does not auto-render Claude hooks into Codex hooks. Codex hook files are validated against Codex-supported events and synchronous `command` handlers only; prompt handlers, agent handlers, and `async: true` command handlers are parsed but skipped by Codex, so target-incompatible Codex hooks fail `skillset build` and `skillset lint`. Claude hook validation stays broad.

## Skill Policy

Skill frontmatter can express normalized policy once and let the compiler render it into target-native files:

```yaml
implicit_invocation: false
allowed_tools:
  claude:
    - Read
    - Grep
  codex: false
```

Values can be shared (`implicit_invocation: false`) or target-scoped (`implicit_invocation: { claude: false, codex: true }`). `implicit_invocation` renders to Claude `disable-model-invocation` and Codex `agents/openai.yaml` `policy.allow_implicit_invocation`. If a Codex source skill already has `agents/openai.yaml`, generated policy is merged into it instead of overwriting the rest of the file.

`allowed_tools` renders to Claude `allowed-tools`, which is preapproval / no-prompt behavior — it suppresses permission prompts for the listed tools, not a portable security sandbox. Codex `agents/openai.yaml` supports tool dependencies and invocation policy, but it is not a skill-local equivalent to Claude tool preapproval. For now Codex-enabled skills must leave `allowed_tools.codex` unset or set it to `false`; `skillset lint` rejects shared or Codex-targeted allowed tools until a real Codex permission render is validated.

Use the portable `tool_intent` registry for known tool intent. The old `tools` key is unsupported. The name is deliberate: it records intent and metadata, not a target-enforced permission boundary. The registry is strict, so provider drift is visible instead of silently copied through:

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

Portable keys are `read`, `search`, `write`, `edit`, `shell`, `web_fetch`, `web_search`, and `mcp`. Unknown keys fail `skillset lint` and build; use `_allow` or `_deny` when a target has a native tool rule that the portable registry does not know yet. Portable `allow` / `deny` belongs in the source top-level `tool_intent` block; target-local `claude.tool_intent` and `codex.tool_intent` accept only `_allow` / `_deny` escape keys. Claude renders portable and `_` entries to `allowed-tools` / `disallowed-tools` (preapproval, not enforcement). Codex preserves portable intent and target-native escapes as generated `.skillset.tools.yaml` metadata included in `.skillset.lock`; it does not install, trust, or mutate user-level Codex configuration.

Import helpers add imported source under the active workspace source root and seed release baselines when adoption applies. In ordinary repos, imported source lands under `.skillset/src/skills` or `.skillset/src/plugins` and baselines use `.skillset/changes/state.json`; in dedicated Skillset repos, imported source lands under `skillset/skills` or `skillset/plugins` and baselines use root `changes/state.json`.

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

`skillset import <path>` infers `skill`, `skills`, `plugin`, or `plugins` from the filesystem when it can. Use `--kind skill`, `--kind skills`, `--kind plugin`, or `--kind plugins` when a directory is ambiguous. `--kind skills` means a root whose child directories each contain a `SKILL.md`; this covers user-global skill roots such as `~/.claude/skills`, `~/.codex/skills`, and `~/.agents/skills`. The provider shortcuts above pick those roots directly. Pass kind through `--kind`; positional forms such as `skillset import skill <path>` are unsupported.

Skill imports always copy the full skill directory. If the input path is the `SKILL.md` file itself, the import root becomes its parent directory so sibling `references/`, `scripts/`, `assets/`, `agents/`, `.codex/`, and other sidecars are preserved. Skills-root imports follow symlinked skill directories but de-dupe by real path to avoid importing the same global skill twice through shared roots.

Plugin imports accept source plugins with `skillset.yaml` / `config.yaml`, native Claude generated plugin directories with `.claude-plugin/plugin.json`, native Codex generated plugin directories with `.codex-plugin/plugin.json`, and plugin repositories whose plugins live under a child `plugins/` directory. Native generated plugin imports preserve the native manifest files and synthesize a minimal source `skillset.yaml` when no source config exists.

`importSource` returns an `ImportReport` (also printed by the CLI) with: `copiedFiles`, `inferredSourceFields` (frontmatter keys Skillset recognizes as source), `preservedTargetNativeFields` (Claude/Codex-native keys kept verbatim, such as `allowed-tools`, `disallowed-tools`, `disable-model-invocation`, `model`, `argument-hint`), `unsupportedFields` (unrecognized keys kept verbatim), `warnings`, and `nextChecks`. Import preserves all frontmatter — target-native and unknown keys pass through unchanged — and the report tells you what to review and migrate, so import is a bridge rather than a lossy copier. Import never overwrites an existing source; there is no overwrite mode yet.

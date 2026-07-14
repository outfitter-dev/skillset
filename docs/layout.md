# Layout

`skillset` expects content repositories to separate portable source from generated target outputs:

```text
skillset.yaml
.skillset/
  shared/
    assets/
    references/
    scripts/
    templates/
  partials/
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
      partials/
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
  cache/
  snapshots/
plugins/
  skillset.lock
  README.md
  <plugin-name>/
    claude/
      .claude-plugin/
        plugin.json
      skills/
    codex/
      .codex-plugin/
        plugin.json
      skills/
.claude-plugin/
  marketplace.json
.claude/
  agents/
    <agent-name>.md
  rules/
    skillset.lock
    <topic>.md
  skills/
    skillset.lock
    <skill-name>/
      SKILL.md
.agents/
  skills/
    skillset.lock
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
skillset.lock
```

Repos use root `skillset.yaml` as the workspace manifest and `.skillset/` as the adaptive source root. Generated target roots are meant to be usable as plugin repositories or as inputs to a future publish/sync step. They are not source truth.

This compiler repo uses that same layout for its own source:

- `.skillset/skills/skillset-claude-development` is a Claude-only internal standalone skill for compiler development.
- `.skillset/skills/skillset-codex-development` is a Codex-only internal standalone skill for compiler development.
- `.skillset/plugins/skillset` is the user-facing plugin that explains how to use `skillset`.

## Operational State

Rebuildable operational output uses logical repo paths under `.skillset/cache/`, but physical payloads live in the repo's Skillset-owned XDG cache bucket. The repo ignores `.skillset/cache/` entirely; the logical path is for reports, locks, and command output, not a checked-in directory. Recovery snapshots stay repo-local under `.skillset/snapshots/` because they are delete-safe only after the user no longer needs rollback material; each new snapshot stores backup payloads in a per-run bare Git object store with a manifest that names the restore commit. Portable source, workspace manifests, change entries, release state, generated changelogs, and `skillset.lock` stay in the repo.

Global Skillset state uses Skillset-owned XDG directories, never provider runtime directories and never a dot-prefixed `/.skillset` segment below the XDG base. Skillset uses absolute XDG base values when present; unset, empty, or relative XDG environment values fall back to the documented home-relative defaults.

| Kind | Environment variable | Default | Skillset path |
| --- | --- | --- | --- |
| Config | `XDG_CONFIG_HOME` | `~/.config` | `$XDG_CONFIG_HOME/skillset` |
| Cache | `XDG_CACHE_HOME` | `~/.cache` | `$XDG_CACHE_HOME/skillset` |
| State | `XDG_STATE_HOME` | `~/.local/state` | `$XDG_STATE_HOME/skillset` |
| Data | `XDG_DATA_HOME` | `~/.local/share` | `$XDG_DATA_HOME/skillset` |

The managed known-Skillsets index lives at `$XDG_CONFIG_HOME/skillset/skillsets.json`. It records local checkout paths and normalized repo identities, such as `github:owner/repo`, for marketplace repo resolution convenience. It is machine-local config state, not committed source truth; CI and portable marketplace verification must still resolve from committed marketplace source and remote refs.

Per-repo global cache buckets live directly under `$XDG_CACHE_HOME/skillset/<repo-key>/`; Skillset does not add a default `repos/` layer. Repo keys resolve in this order:

1. `workspace.cacheKey` from the workspace manifest, when a repo intentionally needs a stable override.
2. Automatic local key `<basename>--local-<sha12>`, where the hash is derived from the normalized host name and normalized absolute repo path.

Most repos should not set `workspace.cacheKey`: the automatic key is deterministic for a given machine and checkout path without leaking the raw path into the cache bucket name. It is intentionally local because operational cache contents belong to the concrete filesystem checkout, and host names and absolute checkout paths vary across machines.

Operational cache callers keep reporting logical paths such as `.skillset/cache/latest/`, `.skillset/cache/tests/`, `.skillset/cache/adopt/`, `.skillset/cache/fixtures/`, and `.skillset/cache/reports/`. When those paths are read or written by Skillset commands, they resolve to `$XDG_CACHE_HOME/skillset/<repo-key>/latest/`, `tests/`, `adopt/`, `fixtures/`, and `reports/` respectively.

## Setup Commands

`skillset init` initializes source in an existing repo or directory. It plans by default, writes only with `--yes`, resolves the Git root by default, and validates existing workspace manifests instead of replacing them with generated stubs. In an empty repo, the scaffold is root `skillset.yaml`, `.skillset/.gitkeep`, placeholders for `.skillset/agents`, `.skillset/hooks`, `.skillset/plugins`, `.skillset/rules`, `.skillset/shared`, `.skillset/skills`, `.skillset/_claude`, and `.skillset/_codex`, tracked `.skillset/changes/.gitkeep`, `.skillset/.gitignore`, and a `.skillset/snapshots/.gitignore` sentinel. The `.skillset/.gitignore` file ignores the logical `.skillset/cache/` path entirely because cache payloads live in XDG. `--include ci` adds a user-owned `.github/workflows/skillset-ci.yml` workflow. Init also performs repo-local adoption: it detects unmanaged repo-local provider or Skillset artifacts, skips generated output roots with Skillset locks, and seeds release-state baselines from current versions and normalized source hashes without creating pending changes, history entries, releases, or changelog renderings.

`skillset init [destination]` is the single setup entrypoint. For a new destination it writes root `skillset.yaml`, `.skillset/` source-family placeholders, release baselines, repo guidance, and a Git repository. For an existing repository it preserves unrelated files and plans only missing Skillset setup. Setup does not create or mutate user-level runtime configuration, marketplaces, trust settings, or symlinks.

`skillset new` scaffolds source units inside `.skillset/`. It is preview-first like setup and build: pass `--yes` to write. `skillset new skill "Docs CLI Expert"` derives `docs-cli-expert`, writes `.skillset/skills/docs-cli-expert/SKILL.md`, and suggests `skillset check` / `skillset check --only outputs` without building automatically. Use `--id <id>` and `--name <display name>` when the stable identity and display text differ. Use `--in <plugin-name>` to place a skill under an existing plugin container at `.skillset/plugins/<plugin-name>/skills/<skill>/`; missing containers fail instead of creating implicit plugins. `--preset support` adds empty `references/`, `assets/`, and `scripts/` folders, `--preset evals` adds `evals/evals.json`, and `--preset reference-file` or `--preset examples-file` creates single-file support material when a directory is too heavy. `skillset new agent <name>` writes a project-agent source file under `.skillset/agents/`. Hook scaffolding is still deferred; author native aggregate hooks at `hooks/hooks.json` or adaptive hook units at `hooks/<name>.json` / `hooks/<name>/hook.json`.

The generated setup config uses `compile.targets` for provider selection. Target-native adapter settings belong in explicit provider blocks such as `claude`, `codex`, and `cursor`, and reusable defaults belong in `defaults.<target>.<surface>` or the target-local `defaults` block. The published package requires Bun and ships Bun-built JavaScript bins for `skillset` and `skillset-toolkit`; stable releases run from the default npm dist-tag with commands such as `npx skillset init my-skillset` or `bunx skillset init my-skillset`.

Provider selection, plugin output roots, and standalone skill output roots can be enabled with defaults or configured from the root `skillset.yaml` workspace manifest:

```yaml
compile:
  targets:
    - claude
    - codex
  build: updated
  features:
    promptArguments: true
  skillset:
    metadata: true
  unsupportedDestination: error
```

Omitting `compile.targets` builds every supported provider rendering for portable source. `compile.build` defaults to `updated` and accepts `all`; CLI `--updated` and `--all` override the config for one command, and the resolved mode is recorded in lock provenance. `updated` writes missing or changed generated files and removes stale scoped generated files while leaving unchanged files untouched; `all` rewrites selected generated files and removes stale managed files, but it does not delete whole output roots or claim unmanaged neighbors. `skillset build` is plan-first and writes only with `--yes`. Confirmed builds back up unmanaged collisions and target-side edits under `.skillset/snapshots/<backup-id>/` before replacing or deleting them, and `skillset restore <backup-id>` previews recovery before writing with `--yes`. `compile.skillset.metadata` defaults to `true`; set it to `false` to suppress Skillset's generated `metadata.generated` and `metadata.version` fields in rendered skills. `compile.features.promptArguments` defaults to `true`; set it to `false` to reject Skillset-owned `{{$ARGUMENTS...}}` placeholders. `compile.unsupportedDestination` defaults to `error`, which gates unsupported, lossy, and failed render results before writes. `warn`, `skip`, and `force` soften unsupported/lossy results with warning diagnostics and lock provenance; failed render results still block every policy.

The canonical provider-selection shape is the `compile.targets` list above. This shorthand normalizes to the same internal target plan:

```yaml
compile:
  targets: [claude, codex, cursor]
```

When `compile.targets` is omitted, Skillset normalizes to the default provider plan. Target-specific provider blocks configure native output details and provider-specific opt-outs; they are not a second target-selection surface.

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

Boolean output settings use the default roots: `plugins/`, `.claude/skills`, and `.agents/skills`; plugin bundles default to `plugins/<plugin-name>/<target>/`. Arrays select specific plugin or standalone skill names. Object settings can set `path`, `include`, or `enabled: false`. Explicit `claude.plugins.path` and `codex.plugins.path` values remain self-contained provider roots. When `compile.targets` is present, a root provider object without `enabled` inherits the compile target set, so output-path objects do not accidentally re-enable a provider. Lower-level plugin, skill, and instruction objects keep the existing opt-in semantics. Do not add a bare top-level `targets:` key; provider selection has one home.

Target defaults use `claude.defaults.<surface>` and `codex.defaults.<surface>` as the canonical target-local form. Root `defaults.<target>.<surface>` is a shorthand that normalizes into the same target defaults without making `targets:` a config surface. Supported surfaces are `agents`, `instructions`, `plugins`, and `skills`; unknown surfaces such as `defaults.codex.skill` fail instead of silently no-oping. Defaults fill omitted target options for that surface: plugin defaults override root defaults, file-level target fields override plugin defaults, and target-specific fields override shared portable fields at render time. For example, a root `codex.defaults.skills.model` applies to Codex-enabled skills unless a plugin or skill provides `codex.model`, and `codex.defaults.agents.skillsPrefaceTemplate` customizes generated Codex project-agent skill prefaces.

A top-level skill `model` looks portable but is not portable in v1. It is stripped from generated output and emits a warning unless every enabled target has an explicit target model from `claude.model`, `codex.model`, or target defaults.

Plugin-local `README.md` files are copied into each generated target plugin. Shared source inputs such as `<source-root>/shared/assets`, `<source-root>/shared/scripts`, `<source-root>/shared/references`, `<source-root>/shared/templates`, and plugin-local `<source-root>/plugins/<plugin-name>/shared/` are available for source organization; they are not copied into every output unless a source skill declares them.

## Source Identity

Machine identity derives from directory names. A plugin's id is its directory under `<source-root>/plugins/`, and a skill's id is its directory under `skills/`. Authors should not repeat the directory name in source unless derivation is wrong.

When an explicit identity is needed:

- **Plugins and the root source manifest** keep their explicit identity under the `skillset` block, because that is where plugin/root source metadata lives (`schema`, `version`, presentation, author). Set `skillset.name` only when derivation is wrong. An explicit plugin `skillset.name` must equal the plugin directory name, so derivation and the override never disagree silently.
- **Skills** use the standard Agent Skills top-level `name` and `version`.

Obsolete identity keys fail the build rather than resolving silently: `skillset.id` is unsupported, and skill-local `skillset.name` / `skillset.id` are not used. There is no separate top-level `name` for plugins; introducing one would give a single meaning two homes.

## License Inheritance

Root, plugin, and skill source scopes can declare licensing under the shared
`skillset.license` metadata field. Supported built-in identifiers are
`Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `MIT`, and `MPL-2.0`.
Use `license: none` to opt a scope and its descendants out of generated license
output unless a child scope declares a different license.

License resolution is local-first and inherited by default:

```yaml
skillset:
  license: MIT
```

A `LICENSE.txt` file beside a source scope is also valid source. For example,
`.skillset/LICENSE.txt` applies at the workspace source root,
`.skillset/plugins/<plugin>/LICENSE.txt` applies to a plugin and its skills, and
`.skillset/skills/<skill>/LICENSE.txt` applies to that skill. Literal
`LICENSE.txt` content wins only when the same scope does not declare
`skillset.license`; `license: none` plus a same-scope `LICENSE.txt` fails the
build so an opt-out cannot hide a local license file.

Generated plugin bundles receive a managed `LICENSE.txt` at the plugin root.
Generated plugin skills and standalone skills receive a managed `LICENSE.txt`
beside `SKILL.md` when their resolved scope has a license. These files are
included in `skillset.lock`, so `skillset check --only outputs` reports stale or missing
generated license output like any other managed file.

## Shared Resources

Skill-local supporting files already work when they sit beside `SKILL.md`, for example `references/`, `scripts/`, `assets/`, and `templates/`. Use shared resources when several skills need the same file but generated provider output still needs skill-root-relative paths:

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

Only declared resources are copied. Resource mappings may point at files or directories, but they cannot traverse outside the shared root, write outside the generated skill directory, or overwrite `SKILL.md`, generated Codex sidecars, or skill-local files. Markdown links in `SKILL.md` that target declared `shared:` or `plugin:` resource URLs are rewritten to generated skill-local links; undeclared shared resource links fail the build with a suggested `resources` entry. When a resource uses a custom `to`, a bare link to its source path fails the build, since that path is no longer where the resource lands; link to the rendered target path or use the resource URL. Resource contents are included in `skillset.lock` hashes and stale-output checks.

`skillset check` adds authoring diagnostics that catch these earlier:

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

Root and plugin source config support `skillset.schema`. The marker is source-only and never appears in generated artifacts; deeper provenance lives in `skillset.lock`.

JSON Schema artifacts are generated from the same `@skillset/schema` contracts used by runtime validation and live under [docs/reference/schemas](reference/schemas/README.md). When adding or changing config, source metadata, or frontmatter fields, follow the [schema contract workflow](schema-contracts.md) so compiler, Workbench, docs, and generated editor schemas stay aligned. `skillset init` scaffolds workspace manifests with a YAML language-server comment that points to the current workspace config schema instead of adding a `$schema` key to authored YAML.

## Versioning

Root `skillset.version`, plugin `skillset.version`, and skill top-level `version` fields must be semantic versions. Skill-local `skillset.version` is unsupported; use the top-level skill `version`.

Generated plugin manifests receive the plugin version. Generated `SKILL.md` files receive:

```yaml
metadata:
  version: 0.1.0
  generated: skillset@0.1.0
```

Each `skillset.lock` records rendered versions and hashes, plus root normalized build metadata such as `buildMode`, `selectedTargets`, and whether generated Skillset skill metadata was rendered. Locks also carry `renderResults` for the source units represented by that lock, using the `skillset-render-result@1` schema so rendered, transformed, target-native, degraded, skipped, unsupported, and failed render facts survive beyond console output. Plugin lock entries include `includedSkills`, `skippedSkills`, and `targetState`; a target with skipped source skills uses `targetState: intentionally-skipped` so target-specific version bumps are visible even when that target's manifest and skills stay byte-for-byte unchanged. `skillset check --only outputs` reports version drift directly when generated plugin manifest `version` or generated skill `metadata.version` is stale.

## Instructions

Instructions live under `.skillset/rules/**/*.md`. They are for durable repo instructions rather than invokable skills. Internally and in generated output these are still called rules, because Claude's native target is `.claude/rules`.

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

Codex truncates each `AGENTS.md` beyond `project_doc_max_bytes` (32 KiB by default) silently. When a generated `AGENTS.md` crosses that size, `skillset build` and `skillset check --only outputs` warn. To stay under the limit, split instructions across nested directories so they render to scoped `AGENTS.md` files (which load only when working in that subtree), or raise `project_doc_max_bytes` in Codex config.

Skill and instruction Markdown bodies use Skillset preprocessing before target serialization. `{{this.<field>}}` reads from the current document's shared frontmatter, including nested dot paths such as `{{this.metadata.label}}` and scalar values such as numbers and booleans; missing fields fail with the source path and field name. Object and array values render as fenced `json` code blocks in Markdown prose unless already inside a fenced code block; structured sidecars receive compact JSON. Use triple braces such as `{{{this.description}}}` to keep the literal `{{this.description}}` token in generated output. Instructions also support `{{skillset.repo_root}}`, `{{skillset.output_dir}}`, and `{{skillset.source_rule}}`; these render independently for each generated Claude rule and Codex `AGENTS.md` file. All preprocessed files support `{{skillset.source_path}}`, `{{skillset.source_dir}}`, `{{skillset.source_root}}`, `{{parent.name}}`, `{{parent.dir}}`, and `{{parent.tree}}` / `{{parent.tree depth:<depth>}}`. Skill Markdown also supports prompt argument placeholders: `{{$ARGUMENTS}}`, `{{$ARGUMENTS[0]}}`, `{{$ARGUMENTS[1]}}`, and `{{$ARGUMENTS.name}}`. Claude receives native `$ARGUMENTS...`; Codex keeps the markers and gets a one-line replacement instruction. Path partials use `{{shared:path.md}}`, `{{plugin:path.md}}`, or a file path relative to the current source file. Named partials use `{{> name}}`, resolve first from `.skillset/partials/`, then from the current plugin's `partials/` when the source is plugin-bound, and may recurse. `{{> <plugin>.<name>}}` can explicitly address the current plugin's own partial namespace, but cross-plugin partial references are rejected. If no direct `<name>.md` exists, Skillset falls back to a unique basename match under that partial root; multiple matches are ambiguous and fail loudly. Cycles fail with the partial chain. Set `skillset.preprocess: false` in source frontmatter when a Markdown body should keep literal braces; the control is stripped from generated output.

Instruction frontmatter can use top-level `claude` and `codex` target toggles. Set `codex: false` for a Claude-only instruction or `claude: false` for a Codex-only instruction. Generated Codex `AGENTS.md` files are tracked by the root `skillset.lock`. If a build needs to replace an unmanaged `AGENTS.md`, it first backs up the existing file and warns with the restore id. Move existing hand-written guidance into `<source-root>/rules` when you want the compiler to own that destination long term.

`codex: symlink` is a recorded follow-up, not a v1 behavior. Directly symlinking Codex `AGENTS.md` to Claude rule files would expose Claude `paths` frontmatter as Codex instructions.

Codex `.rules` files are not instruction Markdown. They are target-native command execution policy files under Codex config-layer `rules/` directories. Provider source mirrors `<source-root>/_codex/rules/**/*.rules` into `.codex/rules/**/*.rules`, but portable prose instructions continue to render through `AGENTS.md`.

## Target-Specific Source and Plugin Surfaces

Portable project agents live under `<source-root>/agents/*.md`. They render to Claude `.claude/agents/<resolved-name>.md` and Codex `.codex/agents/<resolved-name>.toml`, using the resolved `name` when present and otherwise the source filename stem. Agent source requires `description` plus a body, supports shared `skills` and `initialPrompt`, and keeps target-native fields under `claude` and `codex` blocks. Codex `skills` become a deterministic `developer_instructions` preface, and `initialPrompt` is wrapped in `<initial_prompt>...</initial_prompt>` with closing-tag input rejected. Project-agent files are tracked in the root `skillset.lock`; `skillset list` and `skillset explain` expose their provenance.

Provider source mirrors explicit provider files to provider project roots: `<source-root>/_claude/**` writes to `.claude/**` by default, and `<source-root>/_codex/**` writes to `.codex/**` by default. `claude.projectRoot` and `codex.projectRoot` can override those roots. Codex `.rules` pass through only from `<source-root>/_codex/rules/**/*.rules` to `.codex/rules/**/*.rules`; portable prose instructions never render to Codex command policy.

Some plugin companion paths are target-native rather than portable. Claude output copies `commands/`, `agents/`, `hooks/hooks.json`, `.lsp.json`, `output-styles/`, `themes/`, `monitors/`, `assets/`, `scripts/`, and `src/` when present. Codex output copies `hooks/hooks.json`, `.app.json`, `assets/`, `scripts/`, and `src/`. Plugin-local provider source under `<source-root>/plugins/<plugin>/_claude/**` and `<source-root>/plugins/<plugin>/_codex/**` mirrors into the matching generated plugin bundle only. Codex plugin `.rules` remains unsupported. Current generated JSON, YAML, Markdown, TOML utility output, and lock files are parsed after generation; copied unknown files and binary sidecars are not parsed as text.

MCP server definitions and Claude plugin `bin/` use feature-key source pointers rather than the generic companion copier. Conventional plugin-local `.mcp.json` and `bin/` are discovered unless disabled with `mcp: false` or `bin: false`; explicit `mcp.source` and `bin.source` values must use `repo:<path>` pointers inside the repo and outside configured generated output roots. MCP sources must be JSON files and are validated after generation; `bin` sources must be directories and are copied only to Claude plugin output. Because Codex plugins do not support `bin` in v1, a Codex-enabled plugin with enabled `bin` fails loudly unless the plugin or Codex plugin output selection opts out.

When a Claude pass-through path is present, the generated `.claude-plugin/plugin.json` declares it using the documented manifest field: `mcpServers` for `.mcp.json`, `lspServers` for `.lsp.json`, `outputStyles` for `output-styles/`, and the experimental `experimental.themes` / `experimental.monitors` for `themes/` and `monitors/monitors.json`. Codex plugin manifests declare MCP with `mcpServers` when `.mcp.json` is enabled. The supported Claude plugin component paths were live-doc verified against `code.claude.com/docs/en/plugins` and `code.claude.com/docs/en/plugins-reference` (2026-06-04).

Claude plugin docs now document root `bin/` and plugin-root `settings.json`. Treat both as target-native, not portable. `bin/` is a documented executable component and can be supported through feature-key/source-pointer work. Plugin-root `settings.json` applies default configuration when a Claude plugin is enabled, so Skillset must keep it separate from live user/project settings mutation. Build still emits definitions only: it does not install, trust, enable, or symlink generated output into runtime locations. A reviewed settings suggestion workflow is a future non-goal for v1.

Hooks are generated definitions only. The compiler does not install, trust, or enable hooks in user-level configuration. Native aggregate hooks use provider-shaped `hooks/hooks.json`; adaptive hook units use `hooks/<name>.json` or `hooks/<name>/hook.json` and attach to plugins, skills, or project agents. See [Hooks](features/hooks.md) for the source models and use `skillset lookup hooks --events --compat <target>` or `skillset lookup hooks adaptive --fields --schema` for registry-backed reference details.

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

`allowed_tools` renders to Claude `allowed-tools`, which is preapproval / no-prompt behavior — it suppresses permission prompts for the listed tools, not a portable security sandbox. Codex `agents/openai.yaml` supports tool dependencies and invocation policy, but it is not a skill-local equivalent to Claude tool preapproval. For now Codex-enabled skills must leave `allowed_tools.codex` unset or set it to `false`; `skillset check` rejects shared or Codex-targeted allowed tools until a real Codex permission render is validated.

Use the portable `tools` policy for provider-neutral tool meaning. The block is open-world: unset means provider default, `true` grants or preapproves where possible, and `false` constrains where possible. The registry is strict, so provider drift is visible instead of silently copied through:

```yaml
tools:
  read: true
  search: true
  write: false
  shell:
    - git status
    - git diff *
  mcp:
    linear:
      - issues.*

  claude:
    deny:
      - Bash(rm *)
  codex:
    allow:
      - mcp__linear__experimental.*
```

`tools: readonly` expands to `read: true`, `search: true`, and `write: false`. The first portable keys are `read`, `search`, `write`, `shell`, and `mcp`. `read`, `search`, and `write` are boolean-only; `shell` accepts booleans or a flat list of shell patterns; `mcp` accepts `false` or literal server names mapped to booleans or tool glob lists. Provider-native strings belong only under `tools.<provider>.allow` or `tools.<provider>.deny`. Claude renders portable policy and `tools.claude` native strings to `allowed-tools` / `disallowed-tools` (preapproval and denial rules, not a complete sandbox). Codex preserves portable policy and target-native strings as generated `.skillset.tools.yaml` metadata included in `skillset.lock`; it does not install, trust, or mutate user-level Codex configuration.

Import helpers add imported source under `.skillset/` and seed release baselines when adoption applies. Imported source lands under `.skillset/skills` or `.skillset/plugins`, and baselines use `.skillset/changes/state.json`. Adoption normalizes raw Claude `$ARGUMENTS`, `$ARGUMENTS[n]`, and `$ARGUMENTS.name` occurrences in imported Markdown to Skillset prompt argument placeholders so the source can build for Claude and Codex.

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

`skillset import <path>` infers `skill`, `skills`, `plugin`, or `plugins` from the filesystem when it can. Use `--kind skill`, `--kind skills`, `--kind plugin`, or `--kind plugins` when a directory is ambiguous. `--kind skills` means a root whose child directories each contain a `SKILL.md`; this covers user-global skill roots such as `~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, and `~/.agents/skills`. The provider shortcuts above pick those roots directly. Pass kind through `--kind`; positional forms such as `skillset import skill <path>` are unsupported.

Skill imports always copy the full skill directory. If the input path is the `SKILL.md` file itself, the import root becomes its parent directory so sibling `references/`, `scripts/`, `assets/`, `agents/`, `.codex/`, and other sidecars are preserved. Skills-root imports follow symlinked skill directories but de-dupe by real path to avoid importing the same global skill twice through shared roots.

Plugin imports accept source plugins with `skillset.yaml` / `config.yaml`, native Claude generated plugin directories with `.claude-plugin/plugin.json`, native Codex generated plugin directories with `.codex-plugin/plugin.json`, native Cursor generated plugin directories with `.cursor-plugin/plugin.json`, and plugin repositories whose plugins live under a child `plugins/` directory. Native generated plugin imports preserve the native manifest files and synthesize a minimal source `skillset.yaml` when no source config exists.

Whole-repo `skillset init --adopt all` reconciles native plugin candidates before it writes source. A directory containing multiple Claude, Codex, or Cursor manifests remains one plugin candidate. Separate provider roots can converge into one `.skillset/plugins/<plugin>/` source only when their manifests provide the same identity and version and their complete non-manifest source trees are byte-equivalent. The merged source coalesces compatible sparse portable metadata, re-derives component manifest paths from the imported layout, and keeps residual provider-specific options in explicit target `manifest` overrides; release state retains version authority. A matching name without source evidence is not enough. Same-identity divergent roots, malformed manifests, conflicting provider identities, conflicting provider versions, and conflicting portable metadata block before `skillset.yaml` or `.skillset/` is created. Different identities with identical source material remain separate and produce a review warning. The JSON, Markdown, CLI, and external-fixture reports include the source paths, providers, evidence, and recommended resolution.

`importSource` returns an `ImportReport` (also printed by the CLI) with: `copiedFiles`, `inferredSourceFields` (frontmatter keys Skillset recognizes as source), `preservedTargetNativeFields` (provider-native keys kept verbatim, such as `allowed-tools`, `disallowed-tools`, `disable-model-invocation`, `model`, `argument-hint`), `unsupportedFields` (unrecognized keys kept verbatim), `warnings`, and `nextChecks`. Import preserves all frontmatter — target-native and unknown keys pass through unchanged — and the report tells you what to review and migrate, so import is a bridge rather than a lossy copier. Import never overwrites an existing source; there is no overwrite mode yet.

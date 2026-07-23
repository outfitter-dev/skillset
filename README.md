# Skillset

`skillset` compiles portable agent plugin and skill source into target-native Claude, Codex, and Cursor outputs.

It is developed as public source under Outfitter. The npm package now publishes stable releases under `latest`; prerelease channels such as `beta` should be explicit when used.

This repo also self-hosts a small Skillset source tree:

- standalone internal skills for developing the compiler across its first-class targets;
- one generated `skillset` plugin that teaches agents how to use the compiler.

## Start Here

If you are authoring Skillset source for the first time, start with the
[Five-Minute Quickstart](docs/quickstart.md). It walks one small source unit
from scaffold to generated Claude, Codex, and Cursor outputs without touching
live runtime configuration.

To inspect a complete minimal repo, use the
[First Author Example](examples/first-author/README.md). It is a Skillset
source repo with one skill and one rule, plus checked-in generated
output so `skillset check` and `skillset build` have an
immediate clean target.

Once source exists, `skillset dev` gives you the local edit loop: it
watches source/config paths and reruns diagnostics plus generated-output
previews. It is read-only by default; add `--write` when you want the loop to
write repo-local generated output with the same ownership, backup, and restore
safeguards as `skillset build --yes`. Skillset does not automatically install,
trust, symlink, publish, activate, or mutate user-level Claude, Codex, or
Cursor configuration.

## Docs

- [Five-Minute Quickstart](docs/quickstart.md): the shortest first-author path from source scaffold to generated output.
- [First Author Example](examples/first-author/README.md): a minimal source repo deliberately narrowed to build one skill and one rule to Claude and Codex.
- [Share-Ready Checklist](docs/quickstart.md#share-ready-checklist): the 0.16 author handoff bar before hooks or runtime activation enter the path.
- [Dev Watch](docs/features/dev-watch.md): the default-preview `skillset dev` authoring loop, with explicit `--write` mode.
- [Skillset Design Tenets](docs/tenets.md): the slow-moving doctrine for source-first loadout authoring and target-native rendering.
- [Architecture Decision Records](docs/adrs/README.md): accepted and proposed decisions for source vocabulary, unsupported destination policy, and generated-output promises.
- [Feature Reference](docs/features/README.md): source feature support, target adapter status, and future-only surfaces.
- [Skillset Docs](docs/README.md): the docs map.
- [Layout](docs/layout.md): the current source layout, output shape, and compiler behavior reference.
- [Workbench Check](docs/features/workbench.md): the authoring diagnostics and generated-output verification split.

## Command Reference

From a content repo:

```bash
skillset init               # preview root skillset.yaml + .skillset/ source for the current repo
skillset create my-skillset # preview a named child source repo
skillset build              # plan generated changes without writing
skillset build --yes        # write generated outputs
skillset build --isolated   # mirror the projection under .skillset/cache/latest/ (also: check --only outputs, diff)
skillset check              # comprehensive read-only source + generated-output readiness
skillset check --write      # repair source-driven generated drift; refuses target edits and format migrations
skillset check --only outputs # narrow generated-output freshness check
skillset check --ci --fix   # branch-aware CI gates plus safe mechanical repair
skillset dev         # rerun source diagnostics and generated-output previews on source edits
skillset dev --write # write generated output after clean source edits
skillset diff               # show pending generated changes without writing
skillset explain <path>     # explain a source or generated path (rendering, lock provenance, hashes; add --json for records)
skillset lookup                    # navigate registry-backed subjects and views in a TTY; list subjects otherwise
skillset lookup workspace --fields # inspect schema-backed workspace fields; add --json for records
skillset lookup features [id]      # inspect registry feature capabilities and target support; add --json for records
skillset restore <backup>   # preview restoring a generated-output backup; write with --yes
skillset restore --list     # list integrity-checked generated-output backups without writing
skillset status             # aggregate lint issues, drift, warnings, and render result advisories; add --json for records
skillset test [name]        # run a committed deterministic/runtime declaration
skillset test --target codex --prompt "..." # run an ad hoc provider test
skillset test status        # inspect the retained ad hoc test lifecycle (also: tail, list)
```

`init`, `create`, and `build` are plan-first: they print pending filesystem changes and write only with `--yes`. `skillset check` is read-only by default and combines source diagnostics with generated-output readiness. `check --only outputs` is the narrow freshness check. `check --write` repairs only source-driven drift: it refuses managed target-side edits and provider-format migrations, which must be reconciled or applied through `skillset update`. `check --ci` adds branch-aware Skillset change-entry and package Changesets gates; CI uses `--fix`, not `--write`, and may also emit a Markdown report with `--report`. Removed top-level readiness commands have no compatibility aliases. `skillset init --include ci` scaffolds the corresponding workflow (see [CI](docs/features/ci.md)).

Inspection stays split by question: `status` summarizes current workspace health, `list` inventories generated entries, `explain` traces one path's provenance, and `lookup` answers static contract questions such as `lookup features`. Bare `skillset lookup` guides TTY users through registry-owned subjects, applicable views, compatibility targets, and searchable schema field paths, then prints the ordinary lookup report once. Explicit flags, JSON, pipes, and non-TTY execution remain prompt-free.

See [Workbench Check](docs/features/workbench.md) for the cohesive `check` family, package-level diagnostic scopes, built-in `standard` and `strict` presets, parser/schema checks, Workbench fixtures, and the bounded ast-grep proof point.

The default workspace layout is:

- workspace manifest: `skillset.yaml`
- adaptive source root: `.skillset/`
- plugin source: `.skillset/plugins/<plugin-name>/`
- standalone skill source: `.skillset/skills/<skill-name>/`
- instruction source: `.skillset/rules/**/*.md`
- tracked change state: `.skillset/changes/`
- operational state: logical `.skillset/cache/` records backed by the XDG cache bucket, plus repo-local `.skillset/snapshots/`

Generated destination defaults:

- plugin output root: `plugins/`
- Claude plugin bundle output: `plugins/<plugin-name>/claude/`
- Codex plugin bundle output: `plugins/<plugin-name>/codex/`
- Cursor plugin bundle output: `plugins/<plugin-name>/cursor/`
- Claude standalone skill output: `.claude/skills`
- Codex standalone skill output: `.agents/skills`
- Cursor standalone skill output: `.cursor/skills`
- Claude rule output: `.claude/rules`
- Codex rule output: `AGENTS.md` files at derived repo directories
- Cursor rule output: `.cursor/rules/**/*.mdc`

Use explicit paths when building another repo:

```bash
skillset build --root /path/to/content-repo
skillset check --root /path/to/content-repo
skillset check --only outputs --root /path/to/content-repo
skillset build --root /tmp/example
```

Plugin outputs default to plugin-first bundles under `plugins/<plugin-name>/<target>/`. Source config can also set explicit output roots in target output objects such as `claude.plugins.path`, `codex.skills.path`, or `cursor.skills.path`; explicit provider roots remain self-contained target roots.

## Setup

Prepare this repository checkout for local development or agent startup:

```bash
./scripts/bootstrap.sh repo       # install dependencies when needed
./scripts/bootstrap.sh claude     # Claude startup hook entrypoint
./scripts/bootstrap.sh codex      # Codex startup hook entrypoint
./scripts/bootstrap.sh doctor     # read-only environment diagnostics
./scripts/bootstrap.sh teardown   # remove dist/ and delete-safe local operational leftovers
bun run hooks:install             # install repo-local Lefthook git hooks
bun run ultracite:doctor          # verify the Ultracite/Oxlint/Oxfmt setup
```

The provider-specific commands resolve the repo root from `CLAUDE_PROJECT_DIR`
or `CODEX_WORKTREE_PATH` before falling back to the current Git checkout.
Bootstrap prepares only this local repo; it does not install,
symlink, trust, or activate generated Skillset outputs in global Claude or
Codex runtime locations.

Skillset pins its development/runtime toolchain in `.bun-version` and
`packageManager`, currently `bun@1.3.14`. The `engines.bun` field is the
published package floor for people running the compiled CLI through local
installs, `npx`, or `bunx`; the pin is for reproducible repo bootstrap and CI.

The optional Lefthook setup mirrors the repo's local review gates, and `lefthook.yml` is their single source of truth. Pre-commit uses `bun run skillset:check:outputs`; pre-push runs the repo aggregate and `bun run skillset:check:ci:report`. Both range gates resolve the trunk via `scripts/git-trunk.sh` (`origin/HEAD`, typically `origin/main`).

Ultracite is installed with the documented Oxlint/Oxfmt provider setup (`oxlint.config.ts` extending `ultracite/oxlint/core`, `oxfmt.config.ts` extending `ultracite/oxfmt`). `bun run ultracite:doctor` is part of `bun run check` and must stay clean. `bun run ultracite:check` and `bun run ultracite:fix` are available for the strict formatting/lint cleanup pass, but they are not yet gating the repo because the first strict run has existing formatting and rule findings to resolve deliberately.

Initialize Skillset source in an existing repo:

```bash
skillset init --root /path/to/content-repo
skillset init --root /path/to/content-repo --targets claude --include ci --yes
```

`init` is the existing-repo entrypoint. It previews or writes root `skillset.yaml`, the `.skillset/` source scaffold, and operational sentinels. `init` defaults to the Git root when possible, detects repo-local Claude/Codex/Cursor/Skillset artifacts worth importing, and seeds release-state baselines from current source versions and normalized source hashes without creating a pending change, release, history entry, or changelog projection. That adoption pass is repo-local only; it does not scan or mutate user/global runtime directories.

Create a new source repo, defaulting to `my-skillset` under the current directory:

```bash
skillset create my-skillset
skillset create team-loadout --targets claude,codex --yes
```

`skillset init [directory]` initializes an existing directory; `skillset create [name]` creates a named child under the current directory or `--root` parent and initializes Git. Both preview before writing and never write live Claude, Codex, Cursor, or `.agents` configuration. The published package ships the `skillset` and `skillset-toolkit` Bun-built bins; stable releases run from the default npm dist-tag with commands such as `npx skillset create my-skillset` or `bunx skillset create my-skillset`. Prerelease builds remain available through their explicit tag, such as `skillset@beta`.

Setup creates source and repo-local operational ignore scaffolds only. In an existing repo, `init` creates root `skillset.yaml`, `.skillset/.gitkeep`, placeholders for the main source families under `.skillset/`, `.skillset/changes/.gitkeep`, `.skillset/.gitignore` that ignores the logical `.skillset/cache/` path, and a snapshots ignore sentinel. For a new destination, it also writes root `skillset.lock`, a root `.gitignore` that ignores `.skillset/cache/` and `.skillset/snapshots/` contents, README, lightweight agent guidance, and initializes Git. `--include ci` adds an optional user-owned GitHub Actions workflow. Generated manifests use `compile.targets`, keep source identity under `skillset`, and keep target adapter config in `claude`, `codex`, and `cursor` blocks or root `defaults.<target>.<surface>`.

## Import

Seed source from an existing skill, skills root, plugin, or plugin repository. The happy path infers the kind from the path:

```bash
skillset import /path/to/skill-dir --root /path/to/content-repo
skillset import /path/to/SKILL.md --root /path/to/content-repo
skillset import /path/to/skills-root --kind skills --root /path/to/content-repo
skillset import /path/to/plugin-dir --root /path/to/content-repo
skillset import /path/to/plugins-root --kind plugins --root /path/to/content-repo
```

Use `--kind skill`, `--kind skills`, `--kind plugin`, or `--kind plugins` when inference is ambiguous. Positional kind forms such as `skillset import skill <path>` are unsupported.

Provider shortcuts import user-global skills from the matching local skill root:

```bash
skillset import claude --root /path/to/content-repo  # ~/.claude/skills
skillset import codex --root /path/to/content-repo   # ~/.codex/skills
skillset import cursor --root /path/to/content-repo  # ~/.cursor/skills
skillset import agents --root /path/to/content-repo  # ~/.agents/skills
```

Imports copy files into the active workspace source root, such as `.skillset/skills/<name>` and `.skillset/plugins/<name>`. Passing a `SKILL.md` path imports the full containing skill directory, including sibling `references/`, `scripts/`, `assets/`, `agents/`, and other sidecars. Skills-root imports de-dupe symlinked directories by real path, so the same global skill is not imported twice when `.claude/skills`, `.codex/skills`, `.cursor/skills`, and `.agents/skills` point at one another. Plugin imports write plugin-local `skillset.yaml`; when importing a native Claude, Codex, or Cursor generated plugin that only has `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, or `.cursor-plugin/plugin.json`, Skillset synthesizes a minimal source `skillset.yaml` from the native manifest while preserving the native manifest files as imported context. Import does not install, trust, symlink, publish, mutate registries, or change user-level Claude, Codex, or Cursor config.

Import is a safe bridge, not a lossy copier. It returns a report — printed by the CLI — summarizing the copied files, recognized and target-native fields, warnings, and the next checks to run (`skillset check`, `skillset build`, `skillset check --only outputs`). Target-native and unknown frontmatter is preserved rather than dropped, so nothing is silently lost. Import never overwrites existing source.

Import shares the same version-baseline adoption machinery as `init` when the destination has a buildable Skillset root: imported versions become the starting release-state truth for those source units instead of forcing a fake release or a one-time inline-version migration. Import skips baseline seeding when there is no local Skillset config yet.

## Source Contract

Repos keep workspace source metadata, build configuration, and destination configuration in root `skillset.yaml`, with authored source under `.skillset/`.

Each plugin lives at `<source-root>/plugins/<plugin-name>/` and has its own `skillset.yaml`. Portable plugin fields live under `skillset`; target-specific overrides live under top-level `claude`, `codex`, and `cursor` blocks. Skill source frontmatter can use top-level `name`, `title`, `summary`, `description`, `version`, `resources`, `implicit_invocation`, `allowed_tools`, and the source-only `tools` policy; the compiler derives target-native generated metadata, Claude frontmatter, Codex `agents/openai.yaml` policy where supported, Cursor-native skill/rule/agent output where supported, and skill-local copies of declared resources.

Use root/plugin `skillset.name` only when explicit identity is needed; directory names are the default. Skill identity uses top-level `name`. `skillset.id`, skill-local `skillset.name`, and skill-local `skillset.version` are unsupported. Use root `compile.targets` for provider selection, and do not use bare top-level `targets:`. `compile.build` defaults to `updated` and accepts `all`; CLI `--updated` and `--all` override config for the current command and the resolved mode is recorded in lock metadata. `compile.skillset.metadata: false` suppresses Skillset's generated skill frontmatter metadata. `compile.features.promptArguments` defaults to `true`; set it to `false` to reject Skillset-owned `{{$ARGUMENTS...}}` placeholders. `compile.unsupportedDestination` defaults to `error`; `warn`, `skip`, and `force` soften only lossy or unsupported render results while preserving warning diagnostics and lock provenance. Failed render results still block every policy.

Target adapter configuration stays in `claude`, `codex`, and `cursor` blocks. Root `defaults.<target>.<surface>` is shorthand for target defaults, and `<target>.defaults.<surface>` is the canonical target-local form:

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

cursor:
  projectRoot: .cursor
  userRoot: ~/.cursor
  defaults:
    skills:
      model: cursor-fast
```

Defaults fill omitted target options for the named surface (`agents`, `instructions`, `plugins`, or `skills`). Exact file-level `claude` / `codex` / `cursor` fields win over plugin defaults, plugin defaults win over root defaults, and target-specific fields win over shared portable fields at render time. A top-level skill or project-agent `model` is source-only and warns in v1 unless every enabled target has a target-specific model from defaults or an override; use `claude.model`, `codex.model`, `cursor.model`, or target defaults instead.

Generated output strips source-only keys such as `skillset`, `claude`, `codex`, `cursor`, `agents`, `resources`, `implicit_invocation`, `allowed_tools`, `tools`, `model`, `defaults`, and `targets`. Generated skills receive only lightweight metadata unless `compile.skillset.metadata: false` suppresses it:

```yaml
metadata:
  version: 0.1.0
  generated: skillset@0.1.0
```

Generated roots also receive `skillset.lock` files with deterministic provenance and hashes.

## Shared Resources

Use `<source-root>/shared/` for root shared inputs and `<source-root>/plugins/<plugin-name>/shared/` for plugin-local shared inputs. Shared inputs are not copied wholesale. A skill opts into exact files or directories with source-only `resources` frontmatter:

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

`shared:` points at `<source-root>/shared/`. `plugin:` points at `<source-root>/plugins/<plugin-name>/shared/` and is valid only for plugin-bound skills. Grouped resources default to skill-local target paths such as `references/common.md`, `scripts/check.sh`, `assets/...`, or `templates/...`; use `from` / `to` when the output path should differ.

Generated Claude, Codex, and Cursor skills receive declared copied files beside `SKILL.md`, so links and script references stay skill-root-relative. Markdown links that use declared `shared:` or `plugin:` resource URLs are rewritten to the generated skill-local path; undeclared shared resource links fail the build with a suggested `resources` entry. When a resource uses a custom `to`, a bare (schemeless) link to the resource's source path is ambiguous and fails the build with a diagnostic: link to the emitted target path or use the `shared:`/`plugin:` resource URL instead. Resource mappings cannot write outside the generated skill directory or overwrite `SKILL.md`, generated Codex sidecars, or skill-local files. Resource contents participate in `skillset.lock` hashes and `skillset check --only outputs`.

`skillset check` adds earlier, actionable diagnostics: undeclared resource links (with a suggested entry), skill bodies that depend on plugin-root script paths instead of skill-local copies, and declared `scripts/` resources whose source file is missing an executable bit.

`skillset.schema` marks the source-contract schema and is separate from content versions. It is an optional integer (currently `1`) on root and plugin config that defaults to the current schema when absent; future or non-integer values fail the build. Source `skillset.version` and skill `version` fields must be semantic versions. When adding source/config/frontmatter fields, follow the [schema contract workflow](docs/schema-contracts.md) so `@skillset/schema`, compiler validation, Workbench diagnostics, and generated schema artifacts stay aligned. `skillset check --only outputs` reports explicit version drift when a generated plugin manifest or skill `metadata.version` is stale.

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

`implicit_invocation` renders to Claude `disable-model-invocation` and Codex `agents/openai.yaml` `policy.allow_implicit_invocation`. `allowed_tools` renders to Claude `allowed-tools`; Codex has no confirmed skill-local allowed-tools equivalent, so Codex-enabled source must omit `allowed_tools.codex` or set it to `false`.

Portable tool policy uses the `tools` block. It is open-world: unset means provider default, `true` grants or preapproves where possible, and `false` constrains where possible. Provider-native rule strings live only under provider blocks:

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

`tools: readonly` expands to `read: true`, `search: true`, and `write: false`. Portable keys are `read`, `search`, `write`, `shell`, and `mcp`. Unknown keys fail lint/build. `read`, `search`, and `write` are boolean-only; `shell` accepts booleans or a flat list of shell patterns; `mcp` accepts `false` or literal server names mapped to booleans or tool glob lists. Top-level `tools.allow` / `tools.deny` and target-local `claude.tools` / `codex.tools` / `cursor.tools` are rejected; use `tools.<provider>.allow` / `deny`.

`tools` is policy and metadata, not a portable security boundary on every provider. Claude renders portable entries and `tools.claude` strings to `allowed-tools` and `disallowed-tools`, which are **preapproval / no-prompt** and denial rules, not a complete sandbox. Codex and Cursor have no proven skill-local enforcement surface, so each preserves portable policy and its `tools.<provider>` strings in generated `.skillset.tools.yaml` metadata without mutating user-level policy or trust.

## Instructions

Use `.skillset/rules/**/*.md` for repo instructions that should become Claude rules, Codex `AGENTS.md` files, and Cursor `.mdc` rules.

```yaml
---
paths:
  - docs/**/*.md
---

# Docs Rules

- Keep docs concise and current.
```

The compiler preserves the source hierarchy when writing Claude rules, so `<source-root>/rules/docs/writing.md` becomes `.claude/rules/docs/writing.md`; Cursor renders the matching hierarchy as `.cursor/rules/docs/writing.mdc`. `paths` frontmatter is kept for Claude, translated into Cursor rule frontmatter, and stripped from Codex output.

For Codex, `skillset` derives the nearest useful `AGENTS.md` destination from each path pattern. `docs/**/*.md` writes `docs/AGENTS.md`; `**/*.ts` scans matching repo files and writes to the lowest common directory, such as `src/AGENTS.md` when matching TypeScript files live under `src/`. Multiple source rules that land at the same destination are concatenated deterministically, each preceded by a `<!-- source: ... -->` boundary comment naming its source. Codex truncates `AGENTS.md` beyond `project_doc_max_bytes` (32 KiB default); `skillset build` and `skillset check --only outputs` warn when a generated `AGENTS.md` exceeds it so you can split instructions across nested directories or raise the limit.

Skill and instruction Markdown bodies use Skillset preprocessing before target serialization. `{{this.<field>}}` reads from the current document's shared frontmatter, including nested dot paths and scalar values such as numbers and booleans; missing fields fail with the source path and field name. Use triple braces such as `{{{this.description}}}` to keep `{{this.description}}` literal in generated output. Instructions also support Skillset build-time variables when prose needs target-correct paths:

```md
- Review {{this.description}}.
- Run checks from {{skillset.repo_root}}.
- This generated instruction file lives under {{skillset.output_dir}}.
- Source rule: {{skillset.source_rule}}.
```

`{{skillset.repo_root}}` renders as the relative path from the generated file directory back to the repository root, or `.` at the root. `{{skillset.output_dir}}` renders as the generated file directory relative to the repository root, or `.` at the root. `{{skillset.source_rule}}` renders as the source rule path. Unknown `skillset.*` variables fail the build.

All preprocessed files can use source context variables: `{{skillset.source_path}}`, `{{skillset.source_dir}}`, `{{skillset.source_root}}`, `{{parent.name}}`, `{{parent.dir}}`, and `{{parent.tree}}` / `{{parent.tree depth:<depth>}}`. `parent.tree` renders the current source directory tree with depth `2` by default and accepts explicit depths from `0` through `8`.

Object and array frontmatter values render as fenced `json` code blocks in Markdown prose unless the token already appears inside a fenced code block; structured sidecars such as YAML receive compact JSON so they remain parseable.

Partials use `{{shared:path.md}}`, `{{plugin:path.md}}`, or a file path relative to the current source file. Shared partials read from `<source-root>/shared/`; plugin partials read from the current plugin's `<source-root>/plugins/<plugin>/shared/` and are valid only for plugin-bound source. Missing fields, missing partials, path traversal, and plugin partials outside the current plugin fail loudly. Preprocessing dependencies participate in lock hashes and `skillset explain` output.

Set `skillset.preprocess: false` in source frontmatter when a Markdown body should keep literal braces. The control is source-only and is stripped from generated output.

Skillset-owned variables use `{{skillset.lower_snake_case}}` to match the source YAML naming style. Prompt argument placeholders use `{{$ARGUMENTS}}`, `{{$ARGUMENTS[0]}}`, `{{$ARGUMENTS[1]}}`, and `{{$ARGUMENTS.name}}` when a command needs user-supplied arguments. Claude output receives native `$ARGUMENTS...` placeholders. Codex output keeps the `{{$ARGUMENTS...}}` markers and adds one short instruction to replace them before using commands; Cursor output preserves the markers without that Codex notice. Disable this feature with `compile.features.promptArguments: false`. Target-native raw variables such as Claude `$ARGUMENTS` and `${CLAUDE_*}` remain target-specific and are not rendered by the preprocessing layer.

Rule target toggles use the same top-level target keys:

```yaml
---
paths:
  - docs/**/*.md
claude: true
codex: false
---
```

Generated Codex `AGENTS.md` files are tracked by the root `skillset.lock`. If a build needs to replace an unmanaged `AGENTS.md`, it first writes a backup under `.skillset/snapshots/` and emits a warning with the restore id, so existing hand-written guidance remains recoverable while the generated projection can still be completed deliberately.

`codex: symlink` is intentionally not implemented yet. Path-scoped Claude rules need YAML `paths` frontmatter, and a direct symlink would expose that control block to Codex as instructions.

## Target-Specific Plugin Surfaces

Portable project agents live under `<source-root>/agents/*.md`. They render to Claude `.claude/agents/<resolved-name>.md`, Codex `.codex/agents/<resolved-name>.toml`, and Cursor `.cursor/agents/<resolved-name>.md`; they require `description` plus a body, support shared `skills` and `initialPrompt`, and keep target-native fields under `claude`, `codex`, and `cursor` blocks. Codex `skills` become a deterministic `developer_instructions` preface; configure it with `codex.defaults.agents.skillsPrefaceTemplate` or `defaults.codex.agents.skillsPrefaceTemplate`. Cursor-specific agent fields remain provider-native. Project-agent outputs are tracked in the root `skillset.lock` and are visible through `skillset list` / `skillset explain`.

Plugin companion directories are target-native. Claude receives `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `themes/`, `monitors/`, `assets/`, `scripts/`, and `src/` when those source paths exist; the generated manifest declares each with its documented field (`lspServers`, `outputStyles`, `experimental.themes`, `experimental.monitors`). Codex receives `hooks/hooks.json`, `.mcp.json`, `.app.json`, `assets/`, `scripts/`, and `src/`; Claude plugin `agents/` is not copied into Codex plugin output, and a Codex-enabled plugin with `agents/` fails loudly because Codex plugins do not document that component. Cursor supports only `commands/`, `agents/`, `hooks/hooks.json`, `mcp.json`, `rules/`, and `skills/`; it does not claim Claude/Codex asset or script companion support. Feature keys can own repo source pointers directly: `mcp.source: repo:path/to/mcp.json` copies a repo-owned MCP file to `.mcp.json` for Claude and Codex and to `mcp.json` for Cursor, and `bin.source: repo:path/to/bin` copies a repo-owned directory to Claude plugin `bin/`. `mcp: false` or `bin: false` disables conventional discovery, while absent keys auto-discover conventional `.mcp.json` and Claude `bin/` paths. Codex plugin `bin` output is unsupported and fails loudly when enabled. Pass-through paths are copied as opaque content unless a feature owns validation. Plugin-root `settings.json` is target-native but future-only for reviewed settings suggestion workflows. Build still does not install, trust, enable, or mutate user-level Claude, Codex, or Cursor config.

Hook files are emitted as definitions only. `skillset` does not install, trust, or enable hooks in user-level Claude, Codex, or Cursor config. All three targets emit hooks at the documented default `hooks/hooks.json` with a top-level `{ "hooks": { ... } }` object, sourced from `hooks/hooks.json`. Plugin-root `hooks.json` is unsupported. The compiler does not auto-render one provider's hooks into another provider's hooks.

Hook definitions are checked for target compatibility. Codex hook files must use Codex-supported events — `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SubagentStart`, `SubagentStop`, `UserPromptSubmit`, `Stop` — and synchronous `command` handlers only, because Codex parses but skips prompt handlers, agent handlers, and `async: true` command handlers. Cursor hook files must use Cursor-supported events and `command` handlers with only `type`, `command`, and `timeout`; Cursor rejects `async`. Unsupported events or handler forms fail both `skillset build` and `skillset check`. Claude hook validation stays broad (JSON-object shape) because Claude's hook surface is wider and still evolving.

## Self-Hosted Outputs

In this repo, run:

```bash
bun run skillset:build
bun run skillset:check
bun run skillset:check:outputs
bun run check
```

Self-hosted source lives under root `skillset.yaml`, `.skillset/`, and `.skillset/changes/`. Generated outputs are:

- `.claude/skills/skillset-claude-development`
- `.agents/skills/skillset-codex-development`
- `.cursor/skills/skillset-claude-development` and `.cursor/skills/skillset-codex-development`
- `.claude/rules` when source rules exist
- `.cursor/rules` when source rules exist
- `plugins/skillset/claude`
- `plugins/skillset/codex`
- `plugins/skillset/cursor`
- `.cursor-plugin/marketplace.json`

These are repo-local generated artifacts. Do not symlink them into global Claude, Codex, or Cursor config or publish them as part of normal compiler development.

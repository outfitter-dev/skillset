# Skillset

`skillset` compiles portable agent plugin and skill source into target-native Claude and Codex outputs.

It is developed as public source under Outfitter. The npm package is published under the `beta` tag while the compiler contract is still settling; `latest` remains reserved for stable releases.

This repo also self-hosts a small `.skillset/` source tree:

- standalone internal skills for developing the compiler in Claude and Codex;
- one generated `skillset` plugin that teaches agents how to use the compiler.

## Docs

- [Skillset Design Tenets](docs/tenets.md): the slow-moving doctrine for source-first loadout authoring and target-native lowering.
- [Architecture Decision Records](docs/adrs/README.md): accepted and proposed decisions for source vocabulary, lowering policy, and generated-output promises.
- [Feature Reference](docs/features/README.md): source feature support, target adapter status, and future-only surfaces.
- [Skillset Docs](docs/README.md): the docs map.
- [Layout](docs/layout.md): the current source layout, output shape, and compiler behavior reference.

## Usage

From a content repo:

```bash
skillset init               # preview a minimal .skillset/ scaffold for the current repo
skillset create             # preview a new my-skillset source repo scaffold
skillset build              # plan generated changes without writing
skillset build --yes        # write generated outputs
skillset lint               # source authoring diagnostics
skillset check              # fail if generated outputs are stale
skillset diff               # show pending generated changes without writing
skillset explain <path>     # explain a source or generated path (lowering, lock provenance, hashes)
skillset doctor             # aggregate lint issues + drift + warnings
```

`init`, `create`, and `build` are plan-first: they print pending filesystem changes and write only with `--yes`; `--dry-run` always prevents writes, even when paired with `--yes`. `--scope repo`, `--scope plugins`, `--scope project`, and combinations filter generated destinations for build, diff, check, list, and explain; `--scope user` is accepted but currently has no build outputs. `diff`, `explain`, and `doctor` are read-only authoring aids: they never write generated outputs, install, trust, publish, or mutate user-level config. `diff`, `check`, and `doctor` report missing managed outputs separately from new outputs so intentional deletion and stale locks are visible. `explain` accepts either a source path (e.g. `.skillset/skills/foo/SKILL.md`) or a generated output path and reports how it lowers, its lock entry, target state, and source/output hashes. `doctor` exits non-zero when it finds lint issues, drift, or a build error.

The default contract is:

- source root: `.skillset/`
- root config: `.skillset/config.yaml`
- plugin source: `.skillset/plugins/<plugin-name>/`
- standalone skill source: `.skillset/skills/<skill-name>/`
- instruction source: `.skillset/instructions/**/*.md`
- Claude plugin repo output: `plugins-claude/`
- Codex plugin repo output: `plugins-codex/`
- Claude standalone skill output: `.claude/skills`
- Codex standalone skill output: `.agents/skills`
- Claude rule output: `.claude/rules`
- Codex rule output: `AGENTS.md` files at derived repo directories

Use explicit paths when building another repo:

```bash
skillset build --root /path/to/content-repo
skillset check --root /path/to/content-repo
skillset build --root /tmp/example --source custom-source --dist generated
```

`--dist` is a compatibility override for plugin outputs. Without it, plugin outputs default to `plugins-claude/` and `plugins-codex/`. Source config can also set explicit output roots in target output objects such as `claude.plugins.path` or `codex.skills.path`.

## Setup

Initialize Skillset source in an existing repo:

```bash
skillset init --root /path/to/content-repo
skillset init --root /path/to/content-repo --targets claude --with-agents --with-islands --yes
```

Create a new source repo, defaulting to `my-skillset` under the current directory:

```bash
skillset create
skillset create team-loadout --name team-loadout --targets claude,codex --yes
```

For a user-global source checkout, `skillset create --global` defaults to `~/.skillset/src`. This is still Skillset-owned source, not a live Claude or Codex runtime directory. The corresponding preview/build area is documented as `~/.skillset/build`, but setup does not create it or write to `~/.claude`, `~/.codex`, or `.agents`. The beta package requires Bun and ships Bun-built JavaScript bins for `skillset` and `create-skillset`; it can be run through package managers with commands such as `npx skillset@beta create` or `bunx skillset@beta create`. Setup still routes through the same plan-first `create` flow.

Setup commands create only source files: `.skillset/config.yaml`, `.skillset/src/.gitkeep`, and optional `.skillset/instructions/project.md`, `.skillset/src/agents/`, `.skillset/src/claude/`, and `.skillset/src/codex/rules/` placeholders when requested. The generated config uses `compile.targets`; target adapter config still belongs in `claude` and `codex` blocks or root `defaults.<target>.<surface>`.

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
skillset import agents --root /path/to/content-repo  # ~/.agents/skills
```

Imports copy files into `.skillset/skills/<name>` or `.skillset/plugins/<name>`. Passing a `SKILL.md` path imports the full containing skill directory, including sibling `references/`, `scripts/`, `assets/`, `agents/`, and other sidecars. Skills-root imports de-dupe symlinked directories by real path, so the same global skill is not imported twice when `.claude/skills`, `.codex/skills`, and `.agents/skills` point at one another. Plugin imports write plugin-local `skillset.yaml`; when importing a native Claude/Codex generated plugin that only has `.claude-plugin/plugin.json` or `.codex-plugin/plugin.json`, Skillset synthesizes a minimal source `skillset.yaml` from the native manifest while preserving the native manifest files as imported context. Import does not install, trust, symlink, publish, mutate registries, or change user-level Claude/Codex config.

Import is a safe bridge, not a lossy copier. It returns a report — printed by the CLI — summarizing the copied files, the source fields it recognized, target-native fields preserved verbatim (e.g. Claude `allowed-tools`, `disable-model-invocation`), unrecognized fields kept as-is, warnings, and the next checks to run (`skillset lint`, `build`, `check`). Target-native and unknown frontmatter is preserved rather than dropped, so nothing is silently lost; the warnings point you at fields worth moving to a portable source key or a `claude`/`codex` block. Import never overwrites an existing source — remove it or import under a different `--name`.

## Source Contract

Root source metadata lives at `.skillset/config.yaml`.

Each plugin lives at `.skillset/plugins/<plugin-name>/` and has its own `skillset.yaml`. Portable plugin fields live under `skillset`; target-specific overrides live under top-level `claude` and `codex` blocks. Skill source frontmatter can use top-level `name`, `title`, `summary`, `description`, `version`, `resources`, `implicit_invocation`, `allowed_tools`, and the source-only `tool_intent` map; the compiler derives target-native generated metadata, Claude frontmatter, Codex `agents/openai.yaml` policy where supported, and skill-local copies of declared resources.

Use root/plugin `skillset.name` only when explicit identity is needed; directory names are the default. Skill identity uses top-level `name`. `skillset.id`, skill-local `skillset.name`, and skill-local `skillset.version` are unsupported. Use root `compile.targets` for provider selection, and do not use bare top-level `targets:`. `compile.build` defaults to `updated` and accepts `all`; CLI `--updated` and `--all` override config for the current command and the resolved mode is recorded in lock metadata. `compile.skillset.metadata: false` suppresses Skillset's generated skill frontmatter metadata. `compile.unsupported` currently defaults to `error`; softer modes are reserved until warning, skip, or force provenance is implemented.

Target adapter configuration stays in `claude` and `codex` blocks. Root `defaults.<target>.<surface>` is shorthand for target defaults, and `claude.defaults.<surface>` / `codex.defaults.<surface>` is the canonical target-local form:

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
```

Defaults fill omitted target options for the named surface (`agents`, `instructions`, `plugins`, or `skills`). Exact file-level `claude` / `codex` fields win over plugin defaults, plugin defaults win over root defaults, and target-specific fields win over shared portable fields at render time. A top-level skill or project-agent `model` is source-only and warns in v1 unless every enabled target has a target-specific model from defaults or an override; use `claude.model`, `codex.model`, or target defaults instead.

Generated output strips source-only keys such as `skillset`, `claude`, `codex`, `agents`, `resources`, `implicit_invocation`, `allowed_tools`, `tool_intent`, `model`, `defaults`, and `targets`. Generated skills receive only lightweight metadata unless `compile.skillset.metadata: false` suppresses it:

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

`shared:` points at `.skillset/shared/`. `plugin:` points at `.skillset/plugins/<plugin-name>/shared/` and is valid only for plugin-bound skills. Grouped resources default to skill-local target paths such as `references/common.md`, `scripts/check.sh`, `assets/...`, or `templates/...`; use `from` / `to` when the output path should differ.

Generated Claude and Codex skills receive the copied files beside `SKILL.md`, so links and script references stay skill-root-relative. Markdown links that use declared `shared:` or `plugin:` resource URLs are rewritten to the generated skill-local path; undeclared shared resource links fail the build with a suggested `resources` entry. When a resource uses a custom `to`, a bare (schemeless) link to the resource's source path is ambiguous and fails the build with a diagnostic: link to the emitted target path or use the `shared:`/`plugin:` resource URL instead. Resource mappings cannot write outside the generated skill directory or overwrite `SKILL.md`, generated Codex sidecars, or skill-local files. Resource contents participate in `.skillset.lock` hashes and `skillset check`.

`skillset lint` adds earlier, actionable diagnostics: undeclared resource links (with a suggested entry), skill bodies that depend on plugin-root script paths instead of skill-local copies, and declared `scripts/` resources whose source file is missing an executable bit.

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

Portable tool policy uses the `tool_intent` block. The old `tools` key is unsupported. The name reflects authoring *intent*, not a target-enforced sandbox. Target-native escape hatches use underscore keys: shared escapes live under top-level `tool_intent`, and target-local escapes live under `claude.tool_intent` or `codex.tool_intent`:

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
      - rule: "Bash(newcli safe *)"
codex:
  tool_intent:
    _deny:
      mcp:
        linear:
          tools:
            - experimental.delete
```

Portable `tool_intent.allow` and `tool_intent.deny` accept only known keys: `read`, `search`, `write`, `edit`, `shell`, `web_fetch`, `web_search`, and `mcp`. Unknown keys fail lint/build. Portable `allow` / `deny` belongs in the source top-level `tool_intent` block; target-local `claude.tool_intent` and `codex.tool_intent` accept only `_allow` / `_deny` escape keys.

`tool_intent` is intent and metadata, not a portable security boundary. Claude lowers portable entries to `allowed-tools` and `disallowed-tools`, which are **preapproval / no-prompt** hints — they reduce permission prompts for listed tools, not a sandbox that blocks everything else. Codex has no documented skill-local enforcement surface, so Codex preserves portable intent in generated `.skillset.tools.yaml` metadata without mutating user-level Codex policy or trust. Claude `_allow` and `_deny` entries lower to native rules too. Codex `_allow` and `_deny` entries emit to `.skillset.tools.yaml` under `target_native`, so they are committed, locked, and reviewable.

## Instructions

Use `.skillset/instructions/**/*.md` for repo instructions that should become Claude rules and Codex `AGENTS.md` files. `.skillset/rules/**/*.md` is unsupported for instruction Markdown.

```yaml
---
paths:
  - docs/**/*.md
---

# Docs Rules

- Keep docs concise and current.
```

The compiler preserves the source hierarchy when writing Claude rules, so `.skillset/instructions/docs/writing.md` becomes `.claude/rules/docs/writing.md`. `paths` frontmatter is kept for Claude and stripped from Codex output.

For Codex, `skillset` derives the nearest useful `AGENTS.md` destination from each path pattern. `docs/**/*.md` writes `docs/AGENTS.md`; `**/*.ts` scans matching repo files and writes to the lowest common directory, such as `src/AGENTS.md` when matching TypeScript files live under `src/`. Multiple source rules that land at the same destination are concatenated deterministically, each preceded by a `<!-- source: ... -->` boundary comment naming its source. Codex truncates `AGENTS.md` beyond `project_doc_max_bytes` (32 KiB default); `skillset build`/`check` warns when a generated `AGENTS.md` exceeds it so you can split instructions across nested directories or raise the limit.

Skill and instruction Markdown bodies use Skillset preprocessing before target serialization. `{{this.<field>}}` reads a simple string field from the current document's shared frontmatter; missing fields fail with the source path and field name. Instructions also support Skillset build-time variables when prose needs target-correct paths:

```md
- Review {{this.description}}.
- Run checks from {{skillset.repo_root}}.
- This generated instruction file lives under {{skillset.output_dir}}.
- Source rule: {{skillset.source_rule}}.
```

`{{skillset.repo_root}}` renders as the relative path from the generated file directory back to the repository root, or `.` at the root. `{{skillset.output_dir}}` renders as the generated file directory relative to the repository root, or `.` at the root. `{{skillset.source_rule}}` renders as the source rule path. Unknown `skillset.*` variables fail the build.

Partials use `{{> shared:path.md}}`, `{{> plugin:path.md}}`, or a file path relative to the current source file. Shared partials read from `.skillset/shared/`; plugin partials read from the current plugin's `.skillset/plugins/<plugin>/shared/` and are valid only for plugin-bound source. Missing fields, missing partials, path traversal, and plugin partials outside the current plugin fail loudly. Preprocessing dependencies participate in lock hashes and `skillset explain` output.

Set `skillset.preprocess: false` in source frontmatter when a Markdown body should keep literal braces. The control is source-only and is stripped from generated output.

Skillset-owned variables use `{{skillset.lower_snake_case}}` to match the source YAML naming style. Target-native variables such as Claude `$ARGUMENTS` and `${CLAUDE_*}` remain target-specific and are not rendered by the preprocessing layer.

Rule target toggles use the same top-level target keys:

```yaml
---
paths:
  - docs/**/*.md
claude: true
codex: false
---
```

Generated Codex `AGENTS.md` files are tracked by the root `.skillset.lock`. The build refuses to overwrite an unmanaged `AGENTS.md`, so existing hand-written guidance stays protected until it is moved into `.skillset/instructions` or removed deliberately.

`codex: symlink` is intentionally not implemented yet. Path-scoped Claude rules need YAML `paths` frontmatter, and a direct symlink would expose that control block to Codex as instructions.

## Target-Specific Plugin Surfaces

Portable project agents live under `.skillset/src/agents/*.md`. They lower to Claude `.claude/agents/<resolved-name>.md` and Codex `.codex/agents/<resolved-name>.toml`, require `description` plus a body, support shared `skills` and `initialPrompt`, and keep target-native fields under `claude` and `codex` blocks. Codex `skills` become a deterministic `developer_instructions` preface; configure it with `codex.defaults.agents.skillsPrefaceTemplate` or `defaults.codex.agents.skillsPrefaceTemplate`. Project-agent outputs are tracked in the root `.skillset.lock` and are visible through `skillset list` / `skillset explain`.

Plugin companion directories are target-native. Claude receives `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `themes/`, `monitors/`, `assets/`, `scripts/`, and `src/` when those source paths exist; the generated manifest declares each with its documented field (`lspServers`, `outputStyles`, `experimental.themes`, `experimental.monitors`). Codex receives `hooks/hooks.json`, `.mcp.json`, `.app.json`, `assets/`, `scripts/`, and `src/`; Claude plugin `agents/` is not copied into Codex plugin output, and a Codex-enabled plugin with `agents/` fails loudly because Codex plugins do not document that component. Feature keys can own repo source pointers directly: `mcp.source: repo:path/to/mcp.json` copies a repo-owned MCP file to `.mcp.json` for enabled plugin targets, and `bin.source: repo:path/to/bin` copies a repo-owned directory to Claude plugin `bin/`. `mcp: false` or `bin: false` disables conventional discovery, while absent keys auto-discover conventional `.mcp.json` and Claude `bin/` paths. Codex plugin `bin` output is unsupported and fails loudly when enabled. Pass-through paths are copied as opaque content unless a feature owns validation. Plugin-root `settings.json` is target-native but future-only for reviewed settings suggestion workflows. Build still does not install, trust, enable, or mutate user-level Claude/Codex config.

Hook files are emitted as definitions only. `skillset` does not install, trust, or enable hooks in user-level Claude/Codex config. Both targets emit hooks at the documented default `hooks/hooks.json` with a top-level `{ "hooks": { ... } }` object, sourced from `hooks/hooks.json`. Plugin-root `hooks.json` is unsupported. The compiler does not auto-lower Claude hooks into Codex hooks.

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

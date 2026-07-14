---
title: Use Skillset
description: Use the skillset compiler to build, check, inspect, and import source skills or plugins.
version: 0.1.0
skillset:
  preprocess: false
---

# Use Skillset

Use this skill when a repo has a Skillset workspace or when you need to create one.

## Source Layout

Repos keep workspace config at the root and Skillset source inside `.skillset/`:

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
  skills/
    <skill-name>/
      SKILL.md
  plugins/
    <plugin-name>/
      skillset.yaml
      shared/
        references/
        scripts/
      partials/
      skills/
  hooks/
  agents/
  _claude/
  _codex/
  changes/
  cache/       # logical cache boundary; .gitignore sentinel tracked
  snapshots/   # ignored Git-backed recovery snapshots; .gitignore sentinel tracked
skillset.lock
```

The workspace manifest controls provider defaults, output roots, source identity, schema, version, owner, and root support metadata. Repos use root `skillset.yaml` with source in `.skillset/`. Use `compile.targets` for provider selection, `compile.build: updated | all` for the normalized build mode, `compile.skillset.metadata: false` to suppress generated skill metadata, and `compile.unsupportedDestination: error` for fail-loud unsupported destination. `skillset build` plans by default and writes only with `--yes`; `--scope repo`, `--scope plugins`, `--scope project`, or combinations filter generated destinations. Plugin configs use `<source-root>/plugins/<plugin-name>/skillset.yaml`. Portable plugin metadata lives under `skillset`; skill source can use top-level `title`, `summary`, `description`, and `version`. Target-specific adapter config, defaults, and overrides use top-level provider blocks such as `claude`, `codex`, and `cursor`; root `defaults.<target>.<surface>` is shorthand for target defaults without introducing a bare `targets:` map.

Use setup commands when a repo does not have source yet:

```bash
skillset init --root .                 # preview root skillset.yaml + .skillset/
skillset init --root . --yes           # write the scaffold
skillset init team-loadout             # preview a new source repo
skillset init team-loadout --yes       # create a new source repo
skillset new skill "Docs CLI Expert"   # preview a new source skill
skillset new skill --id docs-cli --name "Docs CLI Expert" --yes
skillset new agent "Release Reviewer" --scope repo --yes
```

`skillset init` is plan-first like `build`: it writes only with `--yes`. It handles existing repositories and new destination directories, resolves the Git root when no destination is given, and creates root `skillset.yaml` plus `.skillset/` source placeholders. Init creates operational ignore sentinels, detects adoptable repo-local provider artifacts, skips generated output roots with Skillset locks, and can adopt all or selected candidates through `--adopt` or acquire them from `--from`. Operational cache payloads reported under `.skillset/cache/` physically resolve to the repo's Skillset-owned XDG cache bucket; Git-backed recovery snapshots stay repo-local under `.skillset/snapshots/`. `--targets claude,codex,cursor` controls generated `compile.targets`; `--include ci` writes a user-owned `.github/workflows/skillset-ci.yml` running `skillset check --ci`.

`skillset new` scaffolds source units in `.skillset/` and never builds automatically. Use `--yes` to write, `--id` to choose a stable kebab-case identity, `--name` to set display text, and `--in <plugin-name>` to place a skill under an existing plugin container. `--preset support` adds `references/`, `assets/`, and `scripts/`; `--preset evals` adds `evals/evals.json`; `--preset reference-file` and `--preset examples-file` add `REFERENCE.md` or `EXAMPLES.md`. `skillset new agent <name>` writes project-agent source under `<source-root>/agents/`. Hook scaffolding is still deferred; author native aggregate hooks at `hooks/hooks.json` or adaptive hook units at `hooks/<name>.json` / `hooks/<name>/hook.json`.

Use `.skillset/rules/**/*.md` for durable repo instructions:

```yaml
---
paths:
  - docs/**/*.md
---

# Docs Rules

- Keep docs concise and current.
```

Claude rules are generated under `.claude/rules/**/*.md` with `paths` frontmatter preserved. Codex rules are generated as `AGENTS.md` files at derived directories: `docs/**/*.md` writes `docs/AGENTS.md`, while broad globs such as `**/*.ts` scan matching repo files and use the lowest common directory. Multiple rules that land at the same `AGENTS.md` are concatenated in source order, each preceded by a `<!-- source: ... -->` boundary comment (path only, no frontmatter). Codex truncates `AGENTS.md` beyond `project_doc_max_bytes` (32 KiB default); `skillset` warns when generated output crosses it — split instructions across nested directories or raise the limit. Confirmed builds back up unmanaged `AGENTS.md` collisions before replacing them; move existing guidance into `<source-root>/rules` when you want `skillset` to own the destination long term, and use `skillset restore <backup-id> --yes` to recover a backed-up file.

Skill and rule bodies are preprocessed before target serialization. Use nested `{{this.<field>}}` for current-frontmatter references, `{{{this.description}}}` to keep a literal `{{this.description}}` token, `{{skillset.source_path}}` and `{{parent.tree depth:2}}` for source context, `{{shared:path.md}}` or `{{plugin:path.md}}` for path partials, `{{> intro}}` for named partials, and `skillset.preprocess: false` when a body should keep literal braces. Named partials resolve from `.skillset/partials/` first, then from the current plugin's `partials/`; `{{> <plugin>.<name>}}` can explicitly address the current plugin's own partial namespace, but cross-plugin partial references fail. Basename fallback must be unique, and recursive cycles fail with the partial chain. Object and array frontmatter values render as fenced `json` blocks in Markdown prose unless already inside a fenced code block, while structured sidecars receive compact JSON. Rule bodies can also use `{{skillset.repo_root}}`, `{{skillset.output_dir}}`, and `{{skillset.source_rule}}`; these render per generated file, so a nested `docs/AGENTS.md` can point back to `..` while a root `AGENTS.md` points to `.`. Missing `this` fields and unknown Skillset variables fail the build.

Use provider blocks such as `claude: false`, `codex: false`, or `cursor: false` in rule frontmatter for target-specific opt-outs. `codex: symlink` is not implemented yet because Claude path-scoped rules need YAML frontmatter that Codex would read as instructions through a direct symlink.

Use portable project agents for reusable project-scoped roles. Source lives at `<source-root>/agents/*.md` with YAML frontmatter plus a Markdown body. `description` and a non-empty body are required; `name` defaults from the filename and resolves the generated filename. Claude emits `.claude/agents/<resolved-name>.md`; Codex emits `.codex/agents/<resolved-name>.toml` with `developer_instructions`. Shared `skills` become a Codex instructions preface (customizable with `codex.defaults.agents.skillsPrefaceTemplate` or `defaults.codex.agents.skillsPrefaceTemplate`), and shared `initialPrompt` is appended in an `<initial_prompt>...</initial_prompt>` block. Keep target-native fields under `claude` and `codex`; top-level `model` warns unless each enabled target has a target-specific model.

Use provider source for explicit provider files that are not adaptive: `<source-root>/_claude/**` mirrors to `.claude/**`, `<source-root>/_codex/**` mirrors to `.codex/**`, and plugin-local provider source under `<source-root>/plugins/<plugin>/_claude/**` or `<source-root>/plugins/<plugin>/_codex/**` mirrors into that generated plugin bundle only. Project provider source and project agents are workspace-managed files in the root `skillset.lock`, not ownership claims on the whole `.claude/` or `.codex/` directory. Codex `.rules` are command execution policy and pass through only from `<source-root>/_codex/rules/**/*.rules`; adaptive rules never render to Codex `.rules`. Use `skillset list` or `skillset explain <path>` to inspect generated lock provenance, including provider source and project agents.

Use source-only `resources` frontmatter when a skill needs shared Markdown, scripts, templates, or assets from root `<source-root>/shared/` or plugin-local `<source-root>/plugins/<plugin-name>/shared/`:

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

`shared:` resolves under root `<source-root>/shared/`. `plugin:` resolves under the current plugin's `shared/` directory and is not valid for standalone skills. Generated provider skills receive declared files beside `SKILL.md`, so references stay skill-root-relative. Markdown links to declared `shared:` or `plugin:` URLs are rewritten to the generated local path, and undeclared shared resource links fail the build. Resource mappings cannot write outside the generated skill, overwrite generated control files, or collide with skill-local files.

Plugin companion paths are target-native. Claude receives `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `themes/`, `monitors/`, `assets/`, `scripts/`, and `src/`, declared in the manifest with their documented fields where the target has manifest fields. Codex receives `hooks/hooks.json`, `.mcp.json`, `.app.json`, `assets/`, `scripts/`, and `src/`. Cursor receives `skills/`, `rules/`, `agents/`, `commands/`, `hooks/hooks.json`, `mcp.json`, `assets/`, `scripts/`, and `src/` with a `.cursor-plugin/plugin.json` manifest. Feature keys can own repo source pointers directly: `mcp.source: repo:path/to/mcp.json` copies a repo-owned MCP file to the target-native MCP destination for enabled plugin targets, and `bin.source: repo:path/to/bin` copies a repo-owned directory to Claude plugin `bin/`. `mcp: false` or `bin: false` disables conventional discovery, while absent keys auto-discover conventional MCP files and Claude `bin/` paths. Codex and Cursor plugin `bin` output is unsupported and fails loudly when enabled. Pass-through paths are copied as opaque content unless a feature owns validation. Plugin-root `settings.json` is target-native but future-only; build does not suggest, copy, install, trust, enable, or mutate live settings as a side effect. Claude plugin `agents/` is not copied into Codex; a Codex-enabled plugin with `agents/` fails loudly because Codex plugins do not document a plugin agent component. Hooks are rendered definitions only and must be JSON objects. Enabled plugin targets render hooks at the documented `hooks/hooks.json` path with a top-level `hooks` object, sourced from `hooks/hooks.json`; plugin-root `hooks.json` is unsupported. Codex and Cursor hook files are validated against their supported event registries and synchronous `command` handlers only; prompt handlers, agent handlers, and `async: true` command handlers are parsed but skipped by Codex. `skillset` does not install, trust, or enable hooks in user-level config.

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

`implicit_invocation` renders to Claude `disable-model-invocation` and Codex `agents/openai.yaml` `policy.allow_implicit_invocation`. `allowed_tools` renders to Claude `allowed-tools`, which is preapproval / no-prompt behavior rather than a portable sandbox; Codex has no confirmed skill-local allowed-tools equivalent, so leave `allowed_tools.codex` unset or set it to `false`.

Use portable `tools` for known tool policy. The block records open-world policy and metadata; it is not a complete target-enforced sandbox on every provider:

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

`tools: readonly` expands to `read: true`, `search: true`, and `write: false`. Portable keys are `read`, `search`, `write`, `shell`, and `mcp`; unknown keys fail lint/build. Provider-native strings belong under `tools.<provider>.allow` or `tools.<provider>.deny`, not at the top level and not under target-local `claude.tools` / `codex.tools`. Claude renders portable policy and `tools.claude` strings to `allowed-tools` and `disallowed-tools` (preapproval and denial rules, not a complete sandbox). Codex renders generated `.skillset.tools.yaml` metadata for portable and target-native policy; it does not install, trust, or mutate user-level Codex configuration.

## Build And Check

```bash
skillset build --root .
skillset check --root .
skillset check --only outputs --root .
skillset diff --root .            # pending generated changes, no writes
skillset explain <path> --root .  # rendering + lock provenance for a source/generated path; add --json for records
skillset restore <backup> --root . # preview restore; add --yes to write
skillset status --root .          # health, drift, warnings, and rendering advisories; add --json for records
skillset hooks print --runner lefthook --pre-commit --pre-push
skillset hooks print --target codex --agent-runtime
skillset hooks run post-tool-use  # advisory runtime guardrail, source-gated
skillset hooks run stop           # blocking runtime guardrail, source-gated
```

`skillset check` is the comprehensive readiness command. Run it before writing generated output when you changed skills, hooks, resources, tool policy, or portability-sensitive content. Use `skillset change check` for focused pending-entry coverage and `skillset status` for a broader human health view.

`skillset check --only outputs` is generated-output freshness. Run it after `skillset build --yes`, before handoff, and whenever you need to prove managed outputs still match source. It reports missing or stale managed files and version drift; it is not a source-authoring linter.

Workbench package diagnostics provide stable scopes, severities, rule ids, and `standard`/`strict` presets for tests and future CLI integration. Scopes are `source`, `workspace`, `provider`, `resource`, `runtime`, `generated`, and `release`. Treat `standard` as the ordinary local/CI bar and `strict` as opt-in convention hardening. Parser/schema checks cover YAML, TOML, JSON, Markdown frontmatter, ordinary workspace config, skills, agents, and hook definitions at the package layer. Resource/runtime/provider diagnostics report facts; they must not install hooks, trust plugins, execute scripts, or mutate provider settings.

`diff`, `explain`, and `status` are read-only authoring aids. They never write generated outputs, install, trust, publish, or mutate user-level config. `explain --json` and `status --json` include full render-result records for agents and automation. `status` exits non-zero on source issues, drift, or a build error, and summarizes notable rendering advisories such as degraded or unsupported render results.

`hooks print` emits copy/paste snippets for existing hook runners or reviewed project-local provider runtime hook configuration. It does not install hooks, overwrite `.git/hooks`, mutate target runtime settings, or trust generated hook code. Pre-commit snippets call `skillset change check --staged`; pre-push snippets call `skillset change check --since origin/main` followed by the comprehensive `skillset check`. Runtime snippets call `skillset hooks run post-tool-use` and `skillset hooks run stop`; both first inspect only Skillset source/change-entry paths, including untracked files. `post-tool-use` is advisory and never blocks on `change status`; `stop` runs `change check` and the comprehensive `check` only when relevant Skillset source changed. Set `SKILLSET_HOOK_COMMAND` in reviewed runtime config only when the default local/installable CLI resolution needs an explicit override.

Generated plugin bundles default to `plugins/<plugin-name>/<target>/` with shared provenance under `plugins/skillset.lock`. Explicit provider plugin paths such as `claude.plugins.path`, `codex.plugins.path`, or `cursor.plugins.path` remain self-contained provider roots. Standalone generated skills default to provider-native skill roots such as `.claude/skills`, `.agents/skills`, and `.cursor/skills`. Generated roots include `skillset.lock` files for deterministic provenance.

Version fields must be semantic versions. Plugin `skillset.version` renders into generated plugin manifests. Skill top-level `version` renders into generated `metadata.version`; plugin-bound skills fall back to plugin version, and standalone skills fall back to root version. `skillset check --only outputs` reports version drift when a generated plugin manifest version or skill `metadata.version` is stale. Plugin lock entries include included and skipped skill versions so target-specific skips are visible without changing unrelated generated skill files.

## Import Existing Source

```bash
skillset import /path/to/SKILL.md --root .
skillset import /path/to/skill-dir --root .
skillset import /path/to/skills-root --kind skills --root .
skillset import /path/to/plugin-dir --root .
skillset import /path/to/plugins-root --kind plugins --root .
skillset import claude --root .
skillset import codex --root .
skillset import cursor --root .
skillset import agents --root .
```

`skillset import <path>` infers `skill`, `skills`, `plugin`, or `plugins` from the filesystem. Use `--kind` when a directory is ambiguous. Passing `SKILL.md` imports the full containing skill directory, including sibling `references/`, `scripts/`, `assets/`, `.codex/`, and other sidecars. The provider shortcuts import from provider skill roots such as `~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, or `~/.agents/skills`; skills-root imports de-dupe symlinked skill directories by real path. Plugin imports write plugin-local `skillset.yaml`, synthesizing a minimal one when importing a native generated plugin that only has a provider plugin manifest such as `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, or `.cursor-plugin/plugin.json`. Imports do not publish, install, symlink, trust, mutate registries, or change user-level config. When the destination has a buildable Skillset root, import reuses init's version-baseline machinery so imported versions become starting release-state truth rather than a fake release or one-time inline-version migration.

## Rules

- Use root `compile.targets` for provider selection. Do not use bare top-level `targets:`.
- Keep target adapter config in provider-specific blocks such as `claude`, `codex`, or `cursor`; use `defaults.<target>` only as shorthand for target defaults.
- Use provider-specific model keys such as `claude.model`, `codex.model`, `cursor.model`, or target defaults for model choices; top-level skill `model` warns in v1.
- Keep `compile.unsupportedDestination` on `error`; `warn`, `skip`, and `force` are reserved until their non-error semantics are implemented.
- Use `skillset.name` for root/plugin explicit identity. `skillset.id` is unsupported.
- Do not hand-edit generated outputs as source truth.
- Keep Claude-only dynamic placeholders out of Codex-enabled skills unless a target-safe fallback exists.

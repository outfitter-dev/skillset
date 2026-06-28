---
title: Use Skillset
description: Use the skillset compiler to build, check, lint, and import source skills or plugins.
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

The workspace manifest controls provider defaults, output roots, source identity, schema, version, owner, and root support metadata. Repos use root `skillset.yaml` with source in `.skillset/`. Use `compile.targets` for provider selection, `compile.build: updated | all` for the normalized build mode, `compile.skillset.metadata: false` to suppress generated skill metadata, and `compile.unsupportedDestination: error` for fail-loud unsupported destination. `skillset build` plans by default and writes only with `--yes`; `--dry-run` always prevents writes, and `--scope repo`, `--scope plugins`, `--scope project`, or combinations filter generated destinations. Plugin configs use `<source-root>/plugins/<plugin-name>/skillset.yaml`. Portable plugin metadata lives under `skillset`; skill source can use top-level `title`, `summary`, `description`, and `version`. Target-specific adapter config, defaults, and overrides use top-level `claude` and `codex`; root `defaults.<target>.<surface>` is shorthand for target defaults without introducing a bare `targets:` map.

Use setup commands when a repo does not have source yet:

```bash
skillset init --root .                 # preview root skillset.yaml + .skillset/
skillset init --root . --yes           # write the scaffold
skillset create                        # preview ./my-skillset as a source repo
skillset create team-loadout --yes     # create a new source repo
skillset create --global --yes         # create ~/.skillset/src
skillset new skill "Docs CLI Expert"   # preview a new source skill
skillset new skill --id docs-cli --name "Docs CLI Expert" --yes
skillset new agent "Release Reviewer" --scope repo --yes
```

`init` and `create` are plan-first like `build`: they write only with `--yes`, and `--dry-run` always prevents writes. `init` is the existing-repo entrypoint; it resolves the Git root by default and creates root `skillset.yaml` plus `.skillset/` source placeholders in an empty repo. Init creates `.skillset/` operational ignore sentinels for logical cache paths and snapshots, detects unmanaged repo-local Claude/Codex/Skillset artifacts, skips generated output roots with Skillset locks, and seeds release-state baselines from source versions and normalized source hashes without creating a release or changelog entry. `create` is the new-repo entrypoint; local create scaffolds a source repo with root `skillset.yaml`, `.skillset/` placeholders, root `skillset.lock`, `.skillset/` operational ignore sentinels, a root `.gitignore` for `.skillset/cache/` and `.skillset/snapshots/` contents while preserving their sentinel files, README, lightweight `AGENTS.md`, and a Git repository by default. Operational cache payloads reported under `.skillset/cache/` physically resolve to the repo's Skillset-owned XDG cache bucket; Git-backed recovery snapshots stay repo-local under `.skillset/snapshots/`. `--targets claude,codex` controls generated `compile.targets`; `--include ci` writes a user-owned `.github/workflows/skillset-ci.yml` running `skillset ci`. `create --global` creates source-only Skillset-owned files at `~/.skillset/src`; it does not support `--root` or `--include`, create repo guidance, initialize Git, or mutate `~/.claude`, `~/.codex`, `.agents`, trust settings, marketplaces, or symlinks. Future `npx create-skillset` / `bunx create-skillset` bootstraps should call the same create flow.

`skillset new` scaffolds source units in `.skillset/` and never builds automatically. Use `--yes` to write, `--id` to choose a stable kebab-case identity, `--name` to set display text, and `--in <plugin-name>` to place a skill under an existing plugin container. `--preset support` adds `references/`, `assets/`, and `scripts/`; `--preset evals` adds `evals/evals.json`; `--preset reference-file` and `--preset examples-file` add `REFERENCE.md` or `EXAMPLES.md`. `skillset new agent <name>` writes project-agent source under `<source-root>/agents/`. Split hook scaffolding is deferred because current hook source is still aggregate `hooks/hooks.json`.

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

Use `claude: false` or `codex: false` in rule frontmatter for target-specific opt-outs. `codex: symlink` is not implemented yet because Claude path-scoped rules need YAML frontmatter that Codex would read as instructions through a direct symlink.

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

`shared:` resolves under root `<source-root>/shared/`. `plugin:` resolves under the current plugin's `shared/` directory and is not valid for standalone skills. Generated Claude and Codex skills receive declared files beside `SKILL.md`, so references stay skill-root-relative. Markdown links to declared `shared:` or `plugin:` URLs are rewritten to the generated local path, and undeclared shared resource links fail the build. Resource mappings cannot write outside the generated skill, overwrite generated control files, or collide with skill-local files.

Plugin companion paths are target-native. Claude receives `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `themes/`, `monitors/`, `assets/`, `scripts/`, and `src/`, declared in the manifest with their documented fields where the target has manifest fields. Codex receives `hooks/hooks.json`, `.mcp.json`, `.app.json`, `assets/`, `scripts/`, and `src/`. Feature keys can own repo source pointers directly: `mcp.source: repo:path/to/mcp.json` copies a repo-owned MCP file to `.mcp.json` for enabled plugin targets, and `bin.source: repo:path/to/bin` copies a repo-owned directory to Claude plugin `bin/`. `mcp: false` or `bin: false` disables conventional discovery, while absent keys auto-discover conventional `.mcp.json` and Claude `bin/` paths. Codex plugin `bin` output is unsupported and fails loudly when enabled. Pass-through paths are copied as opaque content unless a feature owns validation. Plugin-root `settings.json` is target-native but future-only; build does not suggest, copy, install, trust, enable, or mutate live settings as a side effect. Claude plugin `agents/` is not copied into Codex; a Codex-enabled plugin with `agents/` fails loudly because Codex plugins do not document a plugin agent component. Hooks are rendered definitions only and must be JSON objects. Both targets render hooks at the documented `hooks/hooks.json` path with a top-level `hooks` object, sourced from `hooks/hooks.json`; plugin-root `hooks.json` is unsupported. Codex hook files are validated against Codex-supported events and synchronous `command` handlers only; prompt handlers, agent handlers, and `async: true` command handlers are parsed but skipped by Codex. `skillset` does not install, trust, or enable hooks in user-level config.

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

Use portable `tool_intent.allow` and `tool_intent.deny` for known tool intent. The old `tools` key is unsupported. The name records intent and metadata, not target-enforced permissions:

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

Portable keys are `read`, `search`, `write`, `edit`, `shell`, `web_fetch`, `web_search`, and `mcp`; unknown keys fail lint/build. Portable `allow` / `deny` belongs in the source top-level `tool_intent` block; target-local `claude.tool_intent` and `codex.tool_intent` accept only `_allow` / `_deny` escape keys. Claude renders portable and `_` entries to `allowed-tools` and `disallowed-tools` (preapproval, not enforcement). Codex renders generated `.skillset.tools.yaml` metadata for portable and target-native intent; it does not install, trust, or mutate user-level Codex configuration.

## Build And Check

```bash
skillset build --root .
skillset lint --root .
skillset check --root .
skillset verify --root .
skillset diff --root .            # pending generated changes, no writes
skillset explain <path> --root .  # rendering + lock provenance for a source/generated path; add --json for records
skillset restore <backup> --root . # preview restore; add --yes to write
skillset doctor --root .          # lint issues, drift, warnings, and rendering advisories; add --json for records
skillset hooks print --runner lefthook --pre-commit --pre-push
skillset hooks print --target codex --agent-runtime
skillset hooks run post-tool-use  # advisory runtime guardrail, source-gated
skillset hooks run stop           # blocking runtime guardrail, source-gated
```

`skillset check` is the current source authoring diagnostics command. Run it before writing generated output when you changed source covered by current lint-style diagnostics, such as skills, hooks, resources, tool intent, or Codex portability-sensitive content. Use `skillset change check` for pending change-entry coverage and `skillset doctor` when you want a broader aggregate read.

`skillset verify` is generated-output freshness. Run it after `skillset build --yes`, before handoff, and whenever you need to prove managed outputs still match source. It reports missing or stale managed files and version drift; it is not a source-authoring linter.

Workbench package diagnostics provide stable scopes, severities, rule ids, and `standard`/`strict` presets for tests and future CLI integration. Scopes are `source`, `workspace`, `provider`, `resource`, `runtime`, `generated`, and `release`. Treat `standard` as the ordinary local/CI bar and `strict` as opt-in convention hardening. Parser/schema checks cover YAML, TOML, JSON, Markdown frontmatter, ordinary workspace config, skills, agents, and hook definitions at the package layer. Resource/runtime/provider diagnostics report facts; they must not install hooks, trust plugins, execute scripts, or mutate Claude/Codex settings.

`diff`, `explain`, and `doctor` are read-only authoring aids. They never write generated outputs, install, trust, publish, or mutate user-level config. `explain --json` and `doctor --json` include full render-result records for agents and automation. `doctor` exits non-zero on lint issues, drift, or a build error, and summarizes notable rendering advisories such as degraded or unsupported render results.

`hooks print` emits copy/paste snippets for existing hook runners or reviewed project-local Claude/Codex runtime hook configuration. It does not install hooks, overwrite `.git/hooks`, mutate target runtime settings, or trust generated hook code. Pre-commit snippets call `skillset change check --staged`; pre-push snippets call `skillset change check --since origin/main`, `skillset check`, `skillset verify`, and `skillset doctor`. Runtime snippets call `skillset hooks run post-tool-use` and `skillset hooks run stop`; both first inspect only Skillset source/change-entry paths, including untracked files. `post-tool-use` is advisory and never blocks on `change status`; `stop` runs `change check`, `check`, and `verify` only when relevant Skillset source changed. Set `SKILLSET_HOOK_COMMAND` in reviewed runtime config only when the default local/installable CLI resolution needs an explicit override.

Generated plugin repos default to `plugins-claude/` and `plugins-codex/`. Standalone generated skills default to `.claude/skills` and `.agents/skills`. Generated roots include `skillset.lock` files for deterministic provenance.

Version fields must be semantic versions. Plugin `skillset.version` renders into generated plugin manifests. Skill top-level `version` renders into generated `metadata.version`; plugin-bound skills fall back to plugin version, and standalone skills fall back to root version. `skillset verify` reports version drift when a generated plugin manifest version or skill `metadata.version` is stale. Plugin lock entries include included and skipped skill versions so target-specific skips are visible without changing unrelated generated skill files.

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

`skillset import <path>` infers `skill`, `skills`, `plugin`, or `plugins` from the filesystem. Use `--kind` when a directory is ambiguous. Passing `SKILL.md` imports the full containing skill directory, including sibling `references/`, `scripts/`, `assets/`, `.codex/`, and other sidecars. The provider shortcuts import from `~/.claude/skills`, `~/.codex/skills`, or `~/.agents/skills`; skills-root imports de-dupe symlinked skill directories by real path. Plugin imports write plugin-local `skillset.yaml`, synthesizing a minimal one when importing a native generated plugin that only has `.claude-plugin/plugin.json` or `.codex-plugin/plugin.json`. Imports do not publish, install, symlink, trust, mutate registries, or change user-level config. When the destination has a buildable Skillset root, import reuses init's version-baseline machinery so imported versions become starting release-state truth rather than a fake release or one-time inline-version migration.

## Rules

- Use root `compile.targets` for provider selection. Do not use bare top-level `targets:`.
- Keep target adapter config in `claude` / `codex`; use `defaults.<target>` only as shorthand for target defaults.
- Use `claude.model`, `codex.model`, or target defaults for model choices; top-level skill `model` warns in v1.
- Keep `compile.unsupportedDestination` on `error`; `warn`, `skip`, and `force` are reserved until their non-error semantics are implemented.
- Use `skillset.name` for root/plugin explicit identity. `skillset.id` is unsupported.
- Do not hand-edit generated outputs as source truth.
- Keep Claude-only dynamic placeholders out of Codex-enabled skills unless a target-safe fallback exists.

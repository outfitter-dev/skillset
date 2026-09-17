---
description: Use the skillset compiler to build, check, inspect, and import source skills or plugins.
metadata:
  skillset.schema: "1"
  version: 0.1.1
name: use-skillset
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
      subagents/
      skills/
  hooks/
  RULES.md
  rules/
  shared/
    partials/
  subagents/
  _claude/
  _codex/
  changes/
  cache/       # logical cache boundary; .gitignore sentinel tracked
  snapshots/   # ignored Git-backed recovery snapshots; .gitignore sentinel tracked
skillset.lock
```

The workspace manifest controls provider defaults, output roots, source identity, schema, version, owner, and root support metadata. Repos use root `skillset.yaml` with source in `.skillset/`. Use `compile.targets` for provider selection, `compile.build: updated | all` for the normalized build mode, `compile.skillset.metadata: false` to suppress generated skill metadata, and `compile.unsupportedDestination: error | warn | skip | force` for explicit lossy or unsupported destination policy. `error` remains the fail-loud default; non-error policies preserve warning diagnostics and lock provenance, and never soften failed render results. `skillset build` plans by default and writes only with `--yes`; `--scope repo`, `--scope plugins`, `--scope project`, or combinations filter generated destinations. Plugin configs use `<source-root>/plugins/<plugin-name>/skillset.yaml`. Plugin content is not copied into project-local provider roots unless root `plugins.internal_use` selects it; omitting that key selects none. Portable plugin metadata lives under `skillset`; skill source can use top-level `title`, `summary`, `description`, and `version`. Target-specific adapter config, defaults, and overrides use top-level provider blocks such as `claude`, `codex`, and `cursor`; root `defaults.<target>.<surface>` is shorthand for target defaults without introducing a bare `targets:` map.

Agent standards are a separate inherent axis: applicable adaptive source produces every adopted standard profile, with no `compile.agents`, root `agents`, plugin, or frontmatter opt-out. Standalone skills use the Agent Skills standard placement under `.agents/skills/`; plugin-owned skills use the Agent Plugins placement under `plugins/<plugin>/agents/skills/`. Root `plugins.internal_use` selections create separately owned project-use copies in fixed provider skill roots. Workspace skills keep the bare leaf name; colliding plugin copies use `<plugin-id>-<leaf>`. With default `internal_marker: true`, live project-use copies receive boolean `metadata.internal: true`; project draft copies always receive it. Their lock entries expose the source unit, effective name, selection rule, and target owner, plus draft origin, applied draft policy, and a same-container shipped sibling when applicable. Plugin hooks, shared trees, MCP servers, and executables do not accompany the copy and surface as unsupported component results. `.skillset/subagents/` remains project-agent source, and `defaults.<provider>.agents` remains provider-specific project-agent configuration. Build scopes filter destinations without selecting standards.

Use setup commands when a repo does not have source yet:

```bash
skillset init --root .                 # preview root skillset.yaml + .skillset/
skillset init --root . --yes           # write the scaffold
skillset create team-loadout           # preview a named child source repo
skillset create team-loadout --yes     # create it and initialize Git
skillset new skill "Docs CLI Expert"   # preview a new source skill
skillset new skill --id docs-cli --name "Docs CLI Expert" --yes
skillset new agent "Release Reviewer" --scope repo --yes
skillset new instruction "Review Guidance" --yes
skillset new hook "Shell Policy" --event PreToolUse --command "echo check" --attach plugin:guard --yes
```

`skillset init` is plan-first like `build`: it writes only with `--yes`. It handles existing repositories or directories, resolves the Git root when no directory is given, and creates root `skillset.yaml` plus `.skillset/` source placeholders. Init creates operational ignore sentinels, detects adoptable repo-local provider artifacts, skips generated output roots with Skillset locks, and can import all or selected detected candidates through `--adopt`. Use `skillset import` for external existing work. `skillset create [name]` creates a normalized named child under the current directory or explicit `--root` parent, defaults to all supported providers, and initializes a local Git repository. Operational cache payloads reported under `.skillset/cache/` physically resolve to the repo's Skillset-owned XDG cache bucket; Git-backed recovery snapshots stay repo-local under `.skillset/snapshots/`. `--targets claude,codex,cursor` controls generated `compile.targets`; `--include ci` writes a user-owned `.github/workflows/skillset-ci.yml` running `skillset check --ci`.

`skillset new` scaffolds source units in `.skillset/` and never builds automatically. Use `--yes` to write, `--id` to choose a stable kebab-case identity, `--name` to set display text, and `--in <plugin-name>` to place a skill or instruction under an existing plugin container. `skillset new skill <name> --draft` creates `<source-root>/skills/_drafts/<id>/SKILL.md`; combine it with `--in <plugin-name>` for a plugin-local draft. The command remains plan-first and authored frontmatter keeps the ordinary leaf name. `--preset support` adds `references/`, `assets/`, and `scripts/`; `--preset evals` adds a portable `evals/evals.json` with the matching `skill_name`; `--preset reference-file` and `--preset examples-file` add `REFERENCE.md` or `EXAMPLES.md`. `skillset eval list` validates those declarations and shows the read-only case/target matrix. `skillset eval run` is the separate opt-in, ungraded provider-execution surface: it retains isolated case workspaces and evidence under logical `.skillset/cache/evals/`, but never changes deterministic `skillset test`, checks, or CI. `expected_output` and `expectations` remain authored context, not automatic grades. A completed eval run records execution/infrastructure success only, never a quality verdict; use `eval status` and `eval tail` to inspect its retained evidence. Declared tests can add `activation[].runtime.claims` to name canonical capability/subject pairs that their successful provider run proves. Current structured runtime evidence supports only `mcp-server` claims; `app` and `plugin-dependency` claims fail preflight before a provider starts. Eval runs cannot declare activation claims or mint proof receipts. Skillset rejects invalid or unavailable claims before launch and considers retained proof current only while its source, rendering, projection, target, and runtime adapter identity still match; ordinary ad hoc tests never make activation claims. `skillset new agent <name>` writes project-agent source under `<source-root>/subagents/`; `skillset new instruction <name>` writes canonical Markdown under `<source-root>/rules/`. `skillset new hook` takes registry-defined `--event` values, exactly one `--command` or `--script` action, and an existing `--attach` source-unit selector. The attachment owner determines canonical adaptive-hook placement; compatible providers are derived unless narrowed with `--provider`. Bare interactive `skillset new` searches the same live attachment/event inventories, displays registry/classifier compatibility, and feeds the same report.

Organize skills beneath plain or parenthesized group directories without changing their identity. Put unpublished work under `_drafts/<skill>/` or declare `status: draft`; `skillset list` and `skillset explain` report the group, status, and draft origin. Workspace drafts render in project skill roots as `draft-<leaf>`. Selected plugin skills inherit a paired same-container draft when `plugins.internal_use.drafts.<plugin>` is omitted; `true` or a list selects drafts explicitly and `false` excludes them. `only` emits only in-scope plugin drafts, while `override` substitutes a paired draft at its live project-use leaf, preserves selected live skills without drafts, and keeps in-scope unpaired drafts under `draft-<leaf>`. Selection and exclusions resolve before either mode. Project drafts use a `[SKILLSET DRAFT] ` description prefix and boolean `metadata.internal: true`, while plugin packages and marketplace output exclude all drafts. Under `rules/`, only `[.]` and `[...]` are reserved scope segments. Other bracketed or parenthesized names are literal and remain unchanged in provider paths; rename the Unicode `[…]` spelling to `[...]`.

New skill ids follow Agent Skills naming: 1 to 64 lowercase letters or digits separated by single hyphens. `skillset new skill` rejects overlong ids, consecutive hyphens, and trailing hyphens before writing.

Move a shipped skill between the workspace and one plugin collection with
`skillset move <from> <to>`. Both paths must be in the same workspace and keep
the same leaf. Preview is read-only; add `--yes` to apply the displayed plan
hash. The transaction carries a same-container `_drafts/<leaf>` sibling,
rewrites current selectors and references, updates generated outputs and lock
provenance, and appends identity history. On plugin-to-workspace moves it
removes direct `plugins.internal_use` skill or draft selections for that leaf
and prints a notice rather than converting them into implicit workspace
selection. `skillset rename` remains the command for changing a leaf inside
one collection and refuses cross-collection destinations.

Use `.skillset/rules/**/*.md` for durable repo instructions:

```yaml
---
paths:
  - docs/**/*.md
---

# Docs Rules

- Keep docs concise and current.
```

Claude rules are generated under `.claude/rules/**/*.md` with `paths` frontmatter preserved. Root `<source-root>/RULES.md` becomes the bare first section of root `AGENTS.md`; it does not render into Claude or Cursor rule directories. Other rules are generated as `AGENTS.md` files at derived directories: `docs/**/*.md` writes `docs/AGENTS.md`, while broad globs such as `**/*.ts` scan matching repo files and use the lowest common directory. Multiple rules that land at the same `AGENTS.md` are concatenated in source order, each preceded by a `<!-- source: ... -->` boundary comment (path only, no frontmatter). Codex truncates `AGENTS.md` beyond `project_doc_max_bytes` (32 KiB default); `skillset` warns when generated output crosses it — split instructions across nested directories or raise the limit. Confirmed builds back up unmanaged root `AGENTS.md` collisions before replacing them; move existing root guidance into `<source-root>/RULES.md` when you want `skillset` to own the destination long term, and use `skillset restore <backup-id> --yes` to recover a backed-up file.

Skill and rule bodies are preprocessed before target serialization. Use nested `{{this.<field>}}` for current-frontmatter references, `{{{this.description}}}` to keep a literal `{{this.description}}` token, `{{skillset.source_path}}` and `{{parent.tree depth:2}}` for source context, `{{shared:path.md}}` or `{{plugin:path.md}}` for path partials, and `{{> intro}}` for named partials. Unrelated double-brace expressions in Markdown, such as JSX object literals, remain unchanged; invalid reserved Skillset expressions still fail. Use `skillset.preprocess: false` when all recognized preprocessing syntax should be preserved literally. Named partials resolve from `.skillset/shared/partials/` first, then from the current plugin's `shared/partials/`; `{{> <plugin>.<name>}}` can explicitly address the current plugin's own partial namespace, but cross-plugin partial references fail. Basename fallback must be unique, and recursive cycles fail with the partial chain. Object and array frontmatter values render as fenced `json` blocks in Markdown prose unless already inside a fenced code block, while structured sidecars receive compact JSON. Rule bodies can also use `{{skillset.repo_root}}`, `{{skillset.output_dir}}`, and `{{skillset.source_rule}}`; these render per generated file, so a nested `docs/AGENTS.md` can point back to `..` while a root `AGENTS.md` points to `.`. Missing `this` fields and unknown Skillset variables fail the build.

Use provider blocks such as `claude: false`, `codex: false`, or `cursor: false` in rule frontmatter for target-specific opt-outs. `codex: symlink` is not implemented yet because Claude path-scoped rules need YAML frontmatter that Codex would read as instructions through a direct symlink.

Use portable project agents for reusable project-scoped roles. Source lives at `<source-root>/subagents/*.md` with YAML frontmatter plus a Markdown body. `description` and a non-empty body are required; `name` defaults from the filename and resolves the generated filename. Claude emits `.claude/agents/<resolved-name>.md`; Codex emits `.codex/agents/<resolved-name>.toml` with `developer_instructions`. Shared `skills` become a Codex instructions preface (customizable with `codex.defaults.agents.skillsPrefaceTemplate` or `defaults.codex.agents.skillsPrefaceTemplate`), and shared `initialPrompt` is appended in an `<initial_prompt>...</initial_prompt>` block. Keep target-native fields under `claude` and `codex`; top-level `model` warns unless each enabled target has a target-specific model.

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

Plugin companion paths are target-native. Authored plugin `subagents/` render to the providers' native `agents/` component for Claude and Cursor. Claude also receives `commands/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `themes/`, `monitors/`, `assets/`, `scripts/`, and `src/`, declared in the manifest with their documented fields where the target has manifest fields. The `codex` target renders a ChatGPT product bundle at `plugins/<plugin>/chatgpt/`: its root `plugin.json` is an Agent Plugins manifest, `skills/` and optional `mcp.json` are portable fixed components, and the closed `extensions.com.openai` delta may reference `./.app.json` and `./hooks/hooks.json`. Cursor receives `skills/`, `rules/`, `agents/`, `commands/`, `hooks/hooks.json`, `mcp.json`, `assets/`, `scripts/`, and `src/` with a `.cursor-plugin/plugin.json` manifest. Feature keys can own repo source pointers directly: `mcp.source: repo:path/to/mcp.json` copies a repo-owned MCP file to the portable ChatGPT MCP component for the Codex target and to the target-native destination elsewhere, and `bin.source: repo:path/to/bin` copies a repo-owned directory to Claude plugin `bin/`. `mcp: false` or `bin: false` disables conventional discovery, while absent keys auto-discover conventional MCP files and Claude `bin/` paths. ChatGPT and Cursor plugin `bin` output is unsupported and fails loudly when enabled. Pass-through paths are copied as opaque content unless a feature owns validation. Plugin-root `settings.json` is target-native but future-only; build does not suggest, copy, install, trust, enable, or mutate live settings as a side effect. Authored plugin `subagents/` are not copied into the ChatGPT bundle; a Codex-enabled plugin with `subagents/` fails loudly because Agent Plugins do not document a plugin agent component. Hooks are rendered definitions only and must be JSON objects. The ChatGPT bundle references normalized hooks at `./hooks/hooks.json`; no legacy Codex provider hook translation or overlay is emitted. `skillset` does not install, trust, or enable hooks in user-level config.

Skill source can also use normalized policy keys:

```yaml
implicit_invocation:
  claude: false
  codex: false
  cursor: false
allowed_tools:
  claude:
    - Read
  codex: false
  cursor: false
```

`implicit_invocation` renders to Claude and Cursor `disable-model-invocation` with inverted polarity, and to Codex `agents/openai.yaml` `policy.allow_implicit_invocation`. Target-native frontmatter overrides the derived Claude or Cursor value when both are present. `allowed_tools` renders to Claude `allowed-tools`, which is preapproval / no-prompt behavior rather than a portable sandbox; Codex and Cursor have no confirmed skill-local allowed-tools equivalent, so leave their target values unset or set them to `false`.

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
skillset explain <path> --root .  # rendering + lock provenance; add --activation for matching local evidence
skillset lookup                   # guided schema/compatibility lookup in a TTY; subject list otherwise
skillset lookup hooks --events --compat codex
skillset lookup activation mcp --compat codex # static provider observability and supported claims
skillset marketplace update       # choose a catalog when needed, preview, and confirm
skillset marketplace update outfitter # explicit catalog; still confirms in a TTY
skillset restore <backup> --root . # preview restore; add --yes to write
skillset status --root .          # deterministic health, drift, warnings, and rendering advisories
skillset status --activation --root . # add bounded local provider evidence; use --json for records
skillset hooks print --runner lefthook --pre-commit --pre-push
skillset hooks print --target codex --agent-runtime
skillset hooks run post-tool-use  # advisory runtime guardrail, source-gated
skillset hooks run stop           # blocking runtime guardrail, source-gated
```

`skillset check` is the comprehensive readiness command. Run it before writing generated output when you changed skills, hooks, resources, tool policy, or portability-sensitive content. Use `skillset change check` for focused pending-entry coverage and `skillset status` for a broader human health view.

When `skillset change check --since <ref>` reports stale or missing evidence, preview `skillset change refresh --since <ref>` with the exact same baseline, then rerun it with `--yes` to append the planned evidence. Reusing the baseline matters for removed scopes and renames; the default release-state or trunk baseline can select a different historical source hash.

`skillset check --only outputs` is generated-output freshness. Run it after `skillset build --yes`, before handoff, and whenever you need to prove managed outputs still match source. It reports missing or stale managed files and version drift; it is not a source-authoring linter.

Workbench package diagnostics provide stable scopes, severities, rule ids, and `standard`/`strict` presets for tests and future CLI integration. Scopes are `source`, `workspace`, `provider`, `resource`, `runtime`, `generated`, and `release`. Treat `standard` as the ordinary local/CI bar and `strict` as opt-in convention hardening. Parser/schema checks cover YAML, TOML, JSON, Markdown frontmatter, ordinary workspace config, skills, agents, and hook definitions at the package layer. Resource/runtime/provider diagnostics report facts; they must not install hooks, trust plugins, execute scripts, or mutate provider settings.

`diff`, `explain`, `lookup`, and `status` are read-only authoring aids. They never write generated outputs, install, trust, publish, or mutate user-level config. Bare `status` and `explain` launch no provider process; `--activation` explicitly adds bounded, sanitized local observations and never changes the ordinary status exit contract. `explain <path> --activation` filters requirements and observations by source provenance. `lookup activation` remains static and Core-derived from Skillset policy joined to Registry provider evidence. Bare `skillset lookup` guides TTY users through canonical subjects, applicable views, compatibility targets, and searchable schema fields, then renders one ordinary report. Explicit lookup arguments, JSON, pipes, and non-TTY execution remain prompt-free. `explain --json` and `status --json` include full render-result records for agents and automation. `status` exits non-zero on source issues, drift, or a build error, and summarizes notable rendering advisories such as degraded or unsupported render results.

Use `skillset report show <id-or-path>` to inspect a completed immutable operational report from Skillset's user-global XDG state store. Prefer the full report UUID; an owned completed bundle directory or its exact `report.json` or `report.md` path is also accepted. The reader validates the closed `skillset.report@1` envelope and its deterministic Markdown view, rejects paths outside the store, and emits the shared finite result envelope with `--json`. Existing test, eval, CI, adoption, and fixture reports keep their producer-specific cache paths and readers until explicitly migrated; `report show` is not an arbitrary-file or legacy-report viewer.

Use `skillset reconcile [generated-path]` for an intentional managed-output conflict. In a TTY, a missing path is collected before the canonical report is rendered; source-wins and output-wins availability comes directly from that report, refused directions stay disabled with their existing reason, and confirmation defaults to No before the same operation writes. `--use source` or `--use output` skips direction selection but still previews and confirms in a TTY unless paired with `--yes`. JSON, pipes, and non-TTY execution never prompt. Decline and cancellation leave source and generated bytes unchanged; confirmed source-wins retains output backup/restore guidance, and output-wins retains source rollback.

Use `skillset marketplace update [catalog]` to preview the existing marketplace readiness/update report and then confirm a Core-owned transaction. A TTY derives catalog names cheaply from the local build graph and prompts only when multiple catalogs exist and none was supplied; opening the picker does not resolve external repositories. Core binds confirmation to the complete provider-output and lock plan, refusing without writes if a floating ref or local input changes after preview. An explicit catalog skips selection, while `--yes`, JSON, pipes, and non-TTY execution skip all prompts. Decline, cancellation, and changed-plan refusal leave provider output and `skillset.lock` byte-identical.

Across interactive routes, prompts collect only missing intent. Canonical setup/source/test/lookup/reconcile/marketplace reports and registries own facts, disabled reasons, diagnostics, plans, and writes. Prompt eligibility requires TTY input and output outside CI and machine modes; Ctrl-C exits 130, rendering follows the active terminal width, and mutation confirmation defaults to No.

`hooks print` emits copy/paste snippets for existing hook runners or reviewed project-local provider runtime hook configuration. It does not install hooks, overwrite `.git/hooks`, mutate target runtime settings, or trust generated hook code. Pre-commit snippets call `skillset change check --staged`; pre-push snippets call `skillset change check --since origin/main` followed by the comprehensive `skillset check`. Runtime snippets call `skillset hooks run post-tool-use` and `skillset hooks run stop`; both first inspect only Skillset source/change-entry paths, including untracked files. `post-tool-use` is advisory and never blocks on `change status`; `stop` runs `change check` and the comprehensive `check` only when relevant Skillset source changed. Set `SKILLSET_HOOK_COMMAND` in reviewed runtime config only when the default local/installable CLI resolution needs an explicit override.

Generated plugin bundles default to `plugins/<plugin-name>/claude/`, `plugins/<plugin-name>/chatgpt/` for the Codex-selected product bundle, and `plugins/<plugin-name>/cursor/`, with the standard Agent Plugins package at `plugins/<plugin-name>/agents/` and shared provenance under `plugins/skillset.lock`. Explicit provider plugin paths such as `claude.plugins.path`, `codex.plugins.path`, or `cursor.plugins.path` remain self-contained provider roots. Standalone generated skills default to provider-native skill roots such as `.claude/skills`, `.agents/skills`, and `.cursor/skills`; plugin-owned standard skills stay inside their Agent Plugins package. Generated roots include `skillset.lock` files for deterministic provenance, including each item's `standard`, `project-use`, or `bundle` role.

Release and change state own generated artifact versions. Existing plugin `skillset.version` and skill top-level `version` fields remain semantic-version compatibility baselines during migration; new source should not add them for ordinary content edits. `skillset check --only outputs` reports version drift when a generated plugin manifest version or skill `metadata.version` is stale. Plugin lock entries include included and skipped skill versions so target-specific skips are visible without changing unrelated generated skill files.

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

`skillset import <path>` infers `skill`, `skills`, `plugin`, or `plugins` from the filesystem. Use `--kind` when a directory is ambiguous. Passing `SKILL.md` imports the full containing skill directory, including sibling `references/`, `scripts/`, `assets/`, `.codex/`, and other sidecars. The provider shortcuts import from provider skill roots such as `~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, or `~/.agents/skills`; skills-root imports de-dupe symlinked skill directories by real path. Plugin imports write plugin-local `skillset.yaml`, synthesizing a minimal one when importing an Agent Plugins package with root `plugin.json` or a native plugin with `.claude-plugin/plugin.json` or `.cursor-plugin/plugin.json`. Legacy `.codex-plugin/plugin.json` remains a compatibility input whose supported meaning must map into the typed OpenAI boundary before modern ChatGPT output is written. Imports do not publish, install, symlink, trust, mutate registries, or change user-level config. When the destination has a buildable Skillset root, import reuses init's version-baseline machinery so imported versions become starting release-state truth rather than a fake release or one-time inline-version migration.

## Rules

- Use root `compile.targets` for provider selection. Do not use bare top-level `targets:`.
- Keep target adapter config in provider-specific blocks such as `claude`, `codex`, or `cursor`; use `defaults.<target>` only as shorthand for target defaults.
- Use provider-specific model keys such as `claude.model`, `codex.model`, `cursor.model`, or target defaults for model choices; top-level skill `model` warns in v1.
- Keep `compile.unsupportedDestination` on its fail-loud `error` default unless a bounded migration or provider-drift exception needs `warn`, `skip`, or `force`. Non-error policies must retain warning diagnostics and lock provenance, and failed render results always block.
- Use `skillset.name` for root/plugin explicit identity. `skillset.id` is unsupported.
- Do not hand-edit generated outputs as source truth.
- Keep Claude-only dynamic placeholders out of Codex-enabled skills unless a target-safe fallback exists.

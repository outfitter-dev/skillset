# Source Layout

> Detailed guidance follows the current compiler source. The router's exact CLI qualification covers only [entry previews](preflight-and-recovery.md); check command-specific help before using deeper operations.

Repos keep workspace config at the root and Skillset source inside `.skillset/`:

```text
skillset.yaml
.skillset/
  RULES.md       # front page for root AGENTS.md and .claude/CLAUDE.md
  rules/
    <topic>.md
  skills/
    <skill-name>/
      SKILL.md
  subagents/
  hooks/
  plugins/
    <plugin-name>/
      skillset.yaml
      skills/
      subagents/
      shared/
        partials/
        references/
        scripts/
      _claude/   # plugin-local provider source
  shared/
    assets/
    partials/
    references/
    scripts/
    templates/
  _claude/       # mirrors to .claude/**
  _codex/        # mirrors to .codex/**
  _cursor/       # mirrors to .cursor/**
  changes/
  cache/         # logical cache boundary; .gitignore sentinel tracked
  snapshots/     # ignored Git-backed recovery snapshots; .gitignore sentinel tracked
skillset.lock
```

An unmanaged root `AGENTS.md` can instead be authored front-page source. Setup or the first successful live build records `workspace.nativeAgents: true`; Skillset reads that file literally and never writes it. This mode cannot coexist with `.skillset/RULES.md` or unscoped `.skillset/rules/*.md`. Root `CLAUDE.md` and `.claude/CLAUDE.md` are preserved guidance for reviewed adoption, never native sources. Use [guided root adoption](root-guidance-adoption.md) when Claude guidance is the stronger starting point or `AGENTS.md` is absent.

Partials live only under `shared/partials/`. A top-level `.skillset/partials/` is the retired layout and blocks the build until you move it.

The workspace manifest controls provider defaults, output roots, source identity, schema, version, owner, and root support metadata. Repos use root `skillset.yaml` with source in `.skillset/`. Use `compile.targets` for provider selection, `compile.build: updated | all` for the normalized build mode, `compile.skillset.metadata: false` to suppress generated skill metadata, and `compile.unsupportedDestination: error | warn | skip | force` for explicit lossy or unsupported destination policy. `error` remains the fail-loud default; non-error policies preserve warning diagnostics and lock provenance, and never soften failed render results. `skillset build` plans by default and writes only with `--yes`; `--scope repo`, `--scope plugins`, `--scope project`, or combinations filter generated destinations. Plugin configs use `<source-root>/plugins/<plugin-name>/skillset.yaml`. Plugin content is not copied into project-local provider roots unless root `plugins.internal_use` selects it; omitting that key selects none. Portable plugin metadata lives under `skillset`; skill source can use top-level `title`, `summary`, `description`, and `version`. Target-specific adapter config, defaults, and overrides use top-level provider blocks such as `claude`, `codex`, and `cursor`; root `defaults.<target>.<surface>` is shorthand for target defaults without introducing a bare `targets:` map.

If the optional project SessionStart hook reports stale generated output, preview with `skillset build`, write with `skillset build --yes`, then confirm with `skillset check --only outputs`; this skill's Build And Check section covers the rest. The hook only advises and never rebuilds automatically. `compile.session_start_hook` selects `auto`, `on`, or `off`, and its project-local settings entry is separate from plugin hooks.

Agent standards are a separate inherent axis: applicable adaptive source produces every adopted standard profile, with no `compile.agents`, root `agents`, plugin, or frontmatter opt-out. Standalone skills use the Agent Skills standard placement under `.agents/skills/`; plugin-owned skills use one immediate-child tree under `plugins/<plugin>/skills/` shared by the Agent Plugins baseline and enabled providers. Root `plugins.internal_use` selections create separately owned project-use copies in fixed provider skill roots. Workspace skills keep the bare leaf name; colliding plugin copies use `<plugin-id>-<leaf>`. With default `internal_marker: true`, live project-use copies receive boolean `metadata.internal: true`; project draft copies always receive it. Their lock entries expose the source unit, effective name, selection rule, and target owner, plus draft origin, applied draft policy, and a same-container shipped sibling when applicable. Referenced skill resources accompany copies, but plugin hooks, unrelated shared trees, MCP servers, and executables do not and may surface as unsupported component results. `.skillset/subagents/` remains project-agent source, and `defaults.<provider>.agents` remains provider-specific project-agent configuration. Build scopes filter destinations without selecting standards.

Use setup commands when a repo does not have source yet:

```bash
skillset init --root .                 # preview root skillset.yaml + .skillset/
skillset init --root . --yes           # write the scaffold
skillset create team-loadout           # preview a named child source repo
skillset create team-loadout --yes     # create it and initialize Git
skillset new skill "Docs CLI Expert"   # preview a new source skill
skillset new skill --id docs-cli --name "Docs CLI Expert" --yes
skillset new agent "Release Reviewer" --scope repo --yes
skillset new rule "Review Guidance" --yes
skillset new hook "Shell Policy" --event PreToolUse --command "echo check" --attach skill:docs-cli --yes
```

`skillset init` is plan-first like `build`: it writes only with `--yes`. It handles existing repositories or directories, resolves the Git root when no directory is given, and creates root `skillset.yaml` plus `.skillset/` source placeholders. Init creates operational ignore sentinels, detects adoptable repo-local provider artifacts, skips generated output roots with Skillset locks, and can import all or selected detected candidates through `--adopt`. Use `skillset import` for external existing work. `skillset create [name]` creates a normalized named child under the current directory or explicit `--root` parent, defaults to all supported providers, and initializes a local Git repository. Operational cache payloads reported under `.skillset/cache/` physically resolve to the repo's Skillset-owned XDG cache bucket; Git-backed recovery snapshots stay repo-local under `.skillset/snapshots/`. `--targets claude,codex,cursor` controls generated `compile.targets`; `--include ci` writes a user-owned `.github/workflows/skillset-ci.yml` running `skillset check --ci`.

`skillset new` scaffolds source units in `.skillset/` and never builds automatically. Use `--yes` to write, `--id` to choose a stable kebab-case identity, `--name` to set display text, and `--in <plugin-name>` to place a skill or rule under an existing plugin container. `skillset new skill <name> --draft` creates `<source-root>/skills/_drafts/<id>/SKILL.md`; combine it with `--in <plugin-name>` for a plugin-local draft. The command remains plan-first and authored frontmatter keeps the ordinary leaf name. `--preset support` adds `references/`, `assets/`, and `scripts/`; `--preset evals` adds a portable `evals/evals.json` with the matching `skill_name`; `--preset reference-file` and `--preset examples-file` add `REFERENCE.md` or `EXAMPLES.md`. `skillset eval list` validates those declarations and shows the read-only case/target matrix. `skillset eval run` is the separate opt-in, ungraded provider-execution surface: it retains isolated case workspaces and evidence under logical `.skillset/cache/evals/`, but never changes deterministic `skillset test`, checks, or CI. `expected_output` and `expectations` remain authored context, not automatic grades. A completed eval run records execution/infrastructure success only, never a quality verdict; use `eval status` and `eval tail` to inspect its retained evidence. Declared tests can add `activation[].runtime.claims` to name canonical capability/subject pairs that their successful provider run proves. Current structured runtime evidence supports only `mcp-server` claims; `app` and `plugin-dependency` claims fail preflight before a provider starts. Eval runs cannot declare activation claims or mint proof receipts. Skillset rejects invalid or unavailable claims before launch and considers retained proof current only while its source, rendering, projection, target, and runtime adapter identity still match; ordinary ad hoc tests never make activation claims. `skillset new agent <name>` writes project-agent source under `<source-root>/subagents/`; `skillset new rule <name>` writes canonical Markdown under `<source-root>/rules/`. `skillset new hook` takes registry-defined `--event` values, exactly one `--command` or `--script` action, and an existing `--attach` source-unit selector. The attachment owner determines canonical adaptive-hook placement; compatible providers are derived unless narrowed with `--provider`. Bare interactive `skillset new` searches the same live attachment/event inventories, displays registry/classifier compatibility, and feeds the same report.

Organize skills beneath plain or parenthesized group directories without changing their identity. Put unpublished work under `_drafts/<skill>/` or declare `status: draft`; `skillset list` and `skillset explain` report the group, status, and draft origin. Workspace drafts render in project skill roots as `draft-<leaf>`. Selected plugin skills inherit a paired same-container draft when `plugins.internal_use.drafts.<plugin>` is omitted; `true` or a list selects drafts explicitly and `false` excludes them. `only` emits only in-scope plugin drafts, while `override` substitutes a paired draft at its live project-use leaf, preserves selected live skills without drafts, and keeps in-scope unpaired drafts under `draft-<leaf>`. Selection and exclusions resolve before either mode. Project drafts use a `[SKILLSET DRAFT] ` description prefix and boolean `metadata.internal: true`, while plugin packages and marketplace output exclude all drafts. Under `rules/`, only `[.]` and `[...]` are reserved scope segments. Other bracketed or parenthesized names are literal and remain unchanged in provider paths; rename the Unicode `[…]` spelling to `[...]`.

New skill ids follow Agent Skills naming: 1 to 64 lowercase letters or digits separated by single hyphens. `skillset new skill` rejects overlong ids, consecutive hyphens, and trailing hyphens before writing.

Fork an existing shipped skill with `skillset draft <shipped-path>`. Preview is
read-only and shows the exact copy, generated effects, plan hash, and source
hash; add `--yes` to create the same-container `_drafts/<leaf>` sibling while
leaving the shipped source in place. Edit that draft, then run `skillset
promote <draft-path>` to preview the authored diff. Paired promotion replaces
the shipped sibling atomically; unpaired promotion moves the draft to the
ordinary path. If the shipped bytes changed after the fork, promotion warns
but still accepts explicit `--yes`. The append-only fork and promotion events
preserve the shipped selector and release history without exposing the private
baseline in frontmatter. Refusal, stale plans, blocked output effects, and
interrupted writes restore source, history, generated output, and lock state.
For a manually paired draft without a recorded fork, promotion diffs against
the current shipped sibling and warns that changes since drafting are unknown;
review that diff before `--yes`.
Same-leaf skills in other containers remain independent.

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

Use `.skillset/rules/**/*.md` for durable repo rules. A rule's directory is the directory it governs: `rules/<topic>.md` applies to the whole repository and `rules/docs/<topic>.md` governs `docs/`. `paths` narrows within that scope and is relative to it, so this `rules/docs/writing.md` covers `docs/**/*.md`:

```yaml
---
paths:
  - "**/*.md"
---

# Docs Rules

- Keep docs concise and current.
```

Claude rules are generated under `.claude/rules/**/*.md`, mirroring the source path, with `paths` frontmatter derived from the scope (`docs/**/*.md` here). Root `<source-root>/RULES.md` becomes the bare first section of root `AGENTS.md` and is also written to `.claude/CLAUDE.md` (or root `CLAUDE.md` with `compile.instruction_front_page: repo-root`); do not hand-author that Claude file beside it, because `check` reports a duplicate root. `RULES.md` does not render into Claude or Cursor rule directories, and Cursor has no supported root `AGENTS.md` placement, so the scaffolded `RULES.md` carries `cursor: false`; keep it when Cursor is a target. Cursor rules are generated as `.cursor/rules/**/<name>.mdc` with the same derived `globs`, or `alwaysApply: true` for an unscoped rule with no `paths`. Each rule also lands in its scope directory's `AGENTS.md` (root `AGENTS.md` when unscoped); Codex cannot narrow below a directory, so `paths` there is reported as a `degraded` render result in `skillset explain`. Bracketed and parenthesized directory names are literal and mirror into generated paths, so `rules/app/[slug]/routing.md` writes `app/[slug]/AGENTS.md`; quote such paths in a shell (`cat 'app/[slug]/AGENTS.md'`), because brackets are glob characters there. Only `[.]` and `[...]` are reserved, and rules under them render nothing until wildcard expansion lands. Multiple rules that land at the same `AGENTS.md` are concatenated in source order, each wrapped in an XML section such as `<coding_guidance source=".skillset/rules/engineering/coding-guidance.md" applies_to="engineering/**" >`; a lone rule without `paths` and the `RULES.md` front page stay bare. Codex truncates `AGENTS.md` beyond `project_doc_max_bytes` (32 KiB default); `skillset` warns when generated output crosses it — split instructions across nested directories or raise the limit. An existing unmanaged root `AGENTS.md` is retained as authored source through native root mode; applying setup or first build records that source choice without replacing the file. Native root mode rejects a competing `<source-root>/RULES.md` or unscoped root rule. Directory-scoped rules still generate nested `AGENTS.md` files. Managed output edits remain drift/reconciliation cases, and other unmanaged destinations retain their collision protection.

Skill and rule bodies are preprocessed before target serialization. Use nested `{{this.<field>}}` for current-frontmatter references, `{{{this.description}}}` to keep a literal `{{this.description}}` token, and `{{skillset.source_path}}` or `{{parent.tree depth:2}}` for source context. Exact workspace partials use `{{> intro}}` or `{{> writing/tone}}` and resolve only under `<source-root>/shared/partials/`; a plugin skill uses `{{> plugin:intro}}` for its own `shared/partials/` root. Explicit includes such as `{{> shared:references/common.md}}` and `{{> plugin:references/checklist.md}}` resolve under the corresponding shared root. There is no workspace-to-plugin fallback or basename search. Skill links use `@{{shared:references/common.md}}` or `@{{plugin:references/checklist.md}}`; the leading `@` remains in generated Markdown and the linked file is copied beside `SKILL.md`. Marked links accept only `references`, `scripts`, `assets`, and `templates` groups. Markdown code spans and fences keep marked links and partial/include directives literal; reserved variables such as `{{this.description}}` still expand there. Use triple braces for a literal variable. Copied Markdown is not recursively preprocessed, and `skillset.preprocess: false` preserves all recognized syntax without implied copies. Missing files, traversal, cycles, invalid groups, symlink escapes, and collisions fail. Object and array frontmatter values render as fenced `json` blocks in Markdown prose unless already inside a fenced code block, while structured sidecars receive compact JSON. Rule bodies can also use `{{skillset.repo_root}}`, `{{skillset.output_dir}}`, and `{{skillset.source_rule}}`; these render per generated file, so a nested `docs/AGENTS.md` can point back to `..` while a root `AGENTS.md` points to `.`. Missing `this` fields and unknown Skillset variables fail the build.

Use provider blocks such as `claude: false`, `codex: false`, or `cursor: false` in rule frontmatter for target-specific opt-outs. `codex: symlink` is not supported, and the schema rejects it: Claude path-scoped rules need YAML frontmatter that Codex would read as instructions through a direct symlink.

Use portable project agents for reusable project-scoped roles. Source lives at `<source-root>/subagents/*.md` with YAML frontmatter plus a Markdown body. `description` and a non-empty body are required; `name` defaults from the filename and resolves the generated filename. Claude emits `.claude/agents/<resolved-name>.md`; Cursor emits `.cursor/agents/<resolved-name>.md`; Codex emits `.codex/agents/<resolved-name>.toml` with `developer_instructions`. Shared `skills` become a Codex instructions preface (customizable with `codex.defaults.agents.skillsPrefaceTemplate` or `defaults.codex.agents.skillsPrefaceTemplate`), and shared `initialPrompt` is appended in an `<initial_prompt>...</initial_prompt>` block. Keep target-native fields under `claude`, `codex`, and `cursor`; top-level `model` warns unless each enabled target has a target-specific model.

Use provider source for explicit provider files that are not adaptive: `<source-root>/_claude/**` mirrors to `.claude/**`, `<source-root>/_codex/**` mirrors to `.codex/**`, `<source-root>/_cursor/**` mirrors to `.cursor/**`, and plugin-local provider source under `<source-root>/plugins/<plugin>/_claude/**`, `_codex/**`, or `_cursor/**` mirrors into that generated plugin bundle only. Project provider source and project agents are workspace-managed files in the root `skillset.lock`, not ownership claims on the whole `.claude/`, `.codex/`, or `.cursor/` directory. Codex `.rules` are command execution policy and pass through only from `<source-root>/_codex/rules/**/*.rules`; adaptive rules never render to Codex `.rules`. Use `skillset list` or `skillset explain <path>` to inspect generated lock provenance, including provider source and project agents.

Use source-only `resources` frontmatter for directories, unlinked files, or destination remaps from root `<source-root>/shared/` or plugin-local `<source-root>/plugins/<plugin-name>/shared/`:

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

`shared:` resolves under root `<source-root>/shared/`. `plugin:` resolves under the current plugin's `shared/` directory and is not valid for standalone skills. A marked link implies the same copy with a default `<group>/<rest>` target; an exact or directory `resources.to` mapping wins. Declared and implied resources share copying, modes, collisions, lock provenance, hashing, explain, and drift behavior. Ordinary Markdown `shared:` or `plugin:` links still require an explicit declaration. Resource mappings cannot write outside the generated skill, overwrite generated control files, escape through symlinks, or collide with skill-local files. Cursor receives the same literal leading-`@` text; Skillset does not claim that Cursor treats it as a native UI mention.

Plugin companion paths remain target-native inside one package. The root `plugin.json`, `.claude-plugin/plugin.json`, and `.cursor-plugin/plugin.json` sit side by side under `plugins/<plugin>/`; enabled providers share one immediate-child `skills/<effective-name>/SKILL.md` tree. Authored grouping directories do not appear in output. Compatible provider-only frontmatter keys are combined, while conflicting values or body bytes fail before writes. Authored package presentation assets render once under package-root `assets/`; skill-local assets and declared shared resources stay inside their skill. Authored plugin `subagents/` render to the documented `agents/` component for Claude and Cursor. The closed `extensions.com.openai` delta may reference `./.app.json` and `./hooks/hooks.json`; Cursor paths remain limited to pinned provider facts. Feature keys can own repo source pointers directly: `mcp.source: repo:path/to/mcp.json` copies a repo-owned MCP file to the portable ChatGPT MCP component for the Codex target and to the target-native destination elsewhere, and `bin.source: repo:path/to/bin` copies a repo-owned directory to Claude plugin `bin/`. `mcp: false` or `bin: false` disables conventional discovery, while absent keys auto-discover conventional MCP files and Claude `bin/` paths. Plugin `bin` has no supported Codex or Cursor destination; those target results are recorded as intentionally skipped under the default policy while supported provider output remains. Pass-through paths are copied as opaque content unless a feature owns validation. Plugin-root `settings.json` is target-native but future-only; build does not suggest, copy, install, trust, enable, or mutate live settings as a side effect. Authored plugin `subagents/` have no supported Codex plugin agent destination and receive an intentionally skipped result under the default policy. Claude and Cursor can still emit their `agents/` component into the shared package; its presence does not imply Codex support. Hooks are rendered definitions only and must be JSON objects. The ChatGPT bundle references normalized hooks at `./hooks/hooks.json`; no legacy Codex provider hook translation or overlay is emitted. `skillset` does not install, trust, or enable hooks in user-level config.

Provider-only plugin components outside a destination's supported envelope are reported as uncovered with provenance and do not block otherwise supported output under the default policy. This does not soften invalid provider content, unsupported MCP transports or dependencies, unsafe paths, or unsupported event mappings. Use the build report to distinguish an uncovered component from a failed render; do not switch policy merely to hide a failure. Workspace hooks attached to a workspace skill (`--attach skill:<id>`) build under the default policy.

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
  mcp: false

  claude:
    deny:
      - Bash(rm *)
```

`tools: readonly` expands to `read: true`, `search: true`, and `write: false`. Portable keys are `read`, `search`, `write`, `shell`, and `mcp`; unknown keys fail lint/build. Provider-native strings belong under `tools.<provider>.allow` or `tools.<provider>.deny`, not at the top level and not under target-local `claude.tools` / `codex.tools`. Claude renders supported portable policy and `tools.claude` strings to `allowed-tools` and `disallowed-tools` (preapproval and denial rules, not a complete sandbox). A nonempty effective portable `mcp` server map is rejected for Claude because portable server identities are not bound to native permission identities. Global `mcp: false` remains supported; explicit native MCP permission strings can be authored under `tools.claude.allow` or `tools.claude.deny` using the intended native identity. Native strings do not establish portable per-server equivalence. Codex renders generated `.skillset.tools.yaml` metadata for portable and target-native policy; it does not install, trust, or mutate user-level Codex configuration.

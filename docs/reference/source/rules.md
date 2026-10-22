---
description: Defines portable rule source, path scoping, provider destination behavior, ownership, and target-native command-policy boundaries.
---

# Rules

Rules are durable repository guidance authored as [source units](../../glossary.md#source-unit) under `.skillset/rules/**/*.md`. They are not invokable skills. Skillset keeps the source hierarchy and [renders](../../glossary.md#render) each enabled provider's supported guidance form.

For the current field set and override shape, use the generated [rule frontmatter schema](../schemas/0.1.0/rule-frontmatter.schema.json) and [example](../examples/rule-frontmatter.yaml). The [rules feature page](../features/rules.md) owns the current support summary.

## Authoring

A rule is Markdown with optional frontmatter and a body. This one lives at `.skillset/rules/docs/guidance.md`:

```markdown
---
paths:
  - "*.md"
  - "guides/**/*.md"
---

# Documentation guidance

- Keep public behavior aligned with its canonical contract.
```

## Scope

Where a rule sits under `.skillset/rules/` is its scope. `rules/<topic>.md` is unscoped and applies to the whole repository. `rules/<dir>/<topic>.md` governs `<dir>/`, so the rule above governs `docs/`. The filename is the topic and may not contain `[` or `]`.

`paths` narrows files within that scope and is relative to the rule's directory: in `rules/docs/`, `"*.md"` means `docs/*.md`. A `paths` entry that starts with its own scope directory, such as `docs/**` inside `rules/docs/`, warns with `rule-scope-path-double-prefix`, because it now means `docs/docs/**`.

Directory names are literal except for two reserved segments: `[.]` matches one level and `[...]` matches any depth. `app/[slug]/` and `app/(marketing)/` are ordinary directories. A rule under a wildcard scope such as `rules/apps/[.]/src/` renders nothing yet and records an `unsupported` render result (`rule-wildcard-scope-pending`) until wildcard expansion lands; it never falls back to the root `AGENTS.md`.

A scope directory that does not exist yet still gets its `AGENTS.md`, with a `rule-scope-directory-missing` warning in case the name is a typo.

Rule frontmatter can also carry shared metadata, explicit provider blocks, and provider toggles. For example, set `codex: false` when a rule is intentionally unavailable to Codex. [Target](../../glossary.md#target)-specific fields override shared intent only for that target; they do not create a second portable meaning.

Use `skillset new rule <name>` to preview a normalized source file under `.skillset/rules/`. `--in <plugin>` selects an existing plugin container, and `--yes` confirms the write. The command refuses collisions and does not run a [build](../../glossary.md#build). See the generated [`new` command reference](../cli/new.md) for the complete CLI contract.

Rule bodies support [preprocessing](preprocessing.md). Set `skillset.preprocess: false` when recognized Skillset expressions must remain literal.

## Destination behavior

Claude and Cursor [destinations](../../glossary.md#destination) follow the enabled targets. Root and scoped `AGENTS.md` files are the Agent Instructions baseline: Skillset writes them whenever rules apply, even when Codex is not a target, and Codex reads them.

| Authored source | Destination | Behavior |
| --- | --- | --- |
| `.skillset/RULES.md` | `.claude/CLAUDE.md` (default) or root `CLAUDE.md` | Renders the front page in its authored dialect with a generated-by header and source-boundary comment. `compile.instruction_front_page` selects `claude-dir` or `repo-root`. |
| `.skillset/RULES.md` | root `AGENTS.md` (Agent Instructions baseline) | Becomes the bare first section of the root `AGENTS.md`, without a source-boundary comment, ahead of unscoped rules. |
| `.skillset/RULES.md` | none for Cursor | Unsupported for Cursor (`cursor-agents-md-root`); Cursor receives only `.skillset/rules/**`. |
| `.skillset/rules/**/*.md` | `.claude/rules/**/*.md` | Mirrors the source path. Frontmatter `paths` is the scope joined with each `paths` entry, sorted, or `<dir>/**` for a scoped rule without `paths`. The literal scope directory is escaped (`app/\[slug\]/**`) because Claude treats an unescaped `[` as a bracket expression. Unscoped rules without `paths` render without frontmatter. |
| `.skillset/rules/**/*.md` | `.cursor/rules/**/*.mdc` | Mirrors the source path and writes the same derived globs, unescaped. A glob containing `[`, `]`, `(` or `)` records a `degraded` render result (`cursor-rule-glob-escaping-unverified`) because Cursor documents no escape. |
| `.skillset/rules/**/*.md` | `<dir>/AGENTS.md` for a rule under `rules/<dir>/`, root `AGENTS.md` when unscoped (Agent Instructions baseline) | Strips source-only frontmatter and combines contributing rules deterministically. |

A rule's `AGENTS.md` is always its scope directory's, whatever files exist in the working tree. Codex reads one instruction file per directory and cannot narrow below it, so a rule with `paths` still reaches all of its scope in the generated `AGENTS.md`; the narrowing is recorded as a `degraded` render result (`codex-rule-paths-not-enforceable`) that `skillset explain <dir>/AGENTS.md` shows.

Generated paths mirror the literal source path, so quote them in a shell: brackets and parentheses are glob characters. Use `cat 'app/[slug]/AGENTS.md'`; zsh otherwise answers "no matches found", and PowerShell needs `-LiteralPath`.

When multiple rules reach one Codex destination, Skillset concatenates them in source-path order, after the `RULES.md` front page in the root `AGENTS.md`. Each rule section begins with a deterministic source-boundary comment so provenance remains visible without leaking source frontmatter into the generated `AGENTS.md` body. Skillset does not use `.codex/AGENTS.md` as a default Codex destination.

Codex may silently truncate an `AGENTS.md` beyond its configured project-document byte limit. Build and output checks warn when generated guidance exceeds the default 32 KiB limit. Move rules into directories under `rules/` so they land in nested `AGENTS.md` files, or deliberately adjust the provider's own configuration.

## Ownership and collisions

Generated rule files are recorded in the root `skillset.lock`. If a confirmed build must replace an unmanaged `AGENTS.md`, Skillset first creates recovery evidence and reports the restore identifier. Move hand-written guidance into `.skillset/rules/` only when you intend Skillset to own that destination; otherwise change the source scope or target selection.

Claude loads both `CLAUDE.md` and `.claude/CLAUDE.md` and concatenates them, so Skillset renders only the placement `compile.instruction_front_page` names. When an unmanaged file sits at the other placement, build and output checks emit a `claude-instructions-duplicate-root` warning naming both paths and leave the unmanaged file untouched. Fold its content into `.skillset/RULES.md` or delete it.

Skillset never writes `AGENTS.override.md`. Codex reads only the first instruction file in a directory, so an unmanaged `AGENTS.override.md` beside a generated `AGENTS.md` hides it; build and output checks warn with `codex-agents-override-shadow`, naming both paths.

`codex: symlink` is not supported. A symlink to a Claude rule would expose Claude-specific frontmatter as Codex guidance and would bypass normal generated ownership.

## Rules are not command policy

Codex `.rules` files describe target-native command execution policy, not Markdown rule prose. Author those files explicitly under `.skillset/_codex/rules/**/*.rules` when that native surface is required. They mirror to `.codex/rules/**/*.rules`; portable rules continue to render through `AGENTS.md`.

The same boundary applies to plugin-native companions: provider-specific plugin `rules/` content is an explicit island, not another location for workspace rule source. Use the [workspace layout](workspace-layout.md#provider-native-islands) to choose the correct owner.

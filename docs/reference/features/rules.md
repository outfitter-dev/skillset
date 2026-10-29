---
description: Rules define adaptive guidance metadata, path scoping, provider projections, and command-policy boundaries.
---

# Rules

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-rules` | `implemented` | `not_applicable` | `not_applicable` | `pass_through` |
| `project-instructions` | `implemented` | `transformed` | `transformed` | `transformed` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Portable [adaptive source](../../glossary.md#adaptive-source) rules live at `.skillset/rules/**/*.md`. They provide durable repository guidance rather than invokable skill behavior.

An existing unmanaged root `AGENTS.md` is retained as authored front-page source. Setup or a successful first live build records native mode; Skillset never writes that file. The [native root guidance contract](../source/rules.md#native-root-guidance) explains its literal Markdown semantics and conflicts with other root rule sources.

## Source Contract

A rule is Markdown with optional frontmatter and a body. Its directory under `rules/` is its scope, so this `.skillset/rules/docs/guidance.md` governs `docs/`:

```markdown
---
paths:
  - "**/*.md"
---

# Documentation guidance

Keep public behavior aligned with its canonical contract.
```

The generated [rule-frontmatter schema and example](../schemas/README.md) own the exact fields. `paths` narrows files within the rule's scope, relative to its directory; the directory alone decides the Codex [destination](../../glossary.md#destination). Shared metadata and provider blocks follow the [frontmatter](../../configuration/frontmatter.md) and [target override](../../configuration/target-overrides.md) contracts.

Directory names under `rules/` remain literal source and output path segments, including `[slug]`, `[...slug]`, and `(marketing)`. Only two exact segments are reserved for derived scope: `[.]` means one directory level and `[...]` means any depth. A Unicode ellipsis segment `[…]` is rejected with a rename to `[...]`; classification alone does not rewrite the mirrored Claude or Cursor path.

Rule-body expressions, partials, resolve-only references, escaping, and `skillset.preprocess: false` belong to [source preprocessing](../source/preprocessing.md). The broader path and ownership rules live in the [rule source reference](../source/rules.md).

When Agent Instructions is adopted, every applicable rule inherently contributes to the root or scoped `AGENTS.md` standard baseline. There is no workspace, plugin, or frontmatter opt-out. A candidate or retired profile produces no standard output.

## Provider Output

| Source | Claude | Codex | Cursor |
| --- | --- | --- | --- |
| `.skillset/RULES.md` | `.claude/CLAUDE.md`, or root `CLAUDE.md` with `compile.instruction_front_page: repo-root` | bare first section of root `AGENTS.md` | unsupported (`cursor-agents-md-root`) |
| `.skillset/rules/<dir>/**/*.md` | `.claude/rules/<dir>/**/*.md`, `paths` joined onto `<dir>/` | `<dir>/AGENTS.md` (root `AGENTS.md` when unscoped) | `.cursor/rules/<dir>/**/*.mdc`, same globs |
| `.skillset/_codex/rules/**/*.rules` | n/a | `.codex/rules/**/*.rules` | n/a |
| Plugin `rules/` | n/a | n/a | plugin `rules/` |

Claude receives the `RULES.md` front page as its project instruction file in its authored dialect, under a generated-by header. Skillset renders exactly one of `.claude/CLAUDE.md` and root `CLAUDE.md` because Claude loads both and concatenates them; only the front page feeds that file, since unscoped rules already reach Claude's launch context through `.claude/rules/`. Plugin packages never receive a `CLAUDE.md`. A rule's directory under `rules/` is its scope, and `paths` narrows within it. Claude and Cursor receive the derived globs; Codex strips source frontmatter and combines contributing rules in deterministic source-path order in the scope directory's `AGENTS.md`, wrapping each in an XML section with `source` and `applies_to` attributes when the file combines rules or one rule narrows with `paths`, and records a `degraded` render result when `paths` narrowing cannot be enforced there. Unscoped rules contribute to the repository root. When Codex and Agent Instructions both consume a compatible `AGENTS.md`, the standard owns one physical file and Codex is recorded as a logical delta consumer.

Codex `.rules` files are [provider-native](../../glossary.md#provider-native) command-execution policy, not rule prose. Plugin `rules/` are Cursor-native companions. Their absent Agent Plugins coverage is [uncovered](plugins.md#uncovered-components), so valid Cursor plugin rules do not block the default build. Neither path is another portable rule [source root](../../glossary.md#source-root).

## Errors and Caveats

Skillset rejects invalid frontmatter, unsupported preprocessing expressions, unsafe partial paths, output collisions, unsupported symlink mode, and attempts to render Markdown rule prose as Codex `.rules`. A generated `AGENTS.md` that exceeds Codex's default project-document byte limit emits a warning; moving rules into directories under `rules/` splits it into nested files. A wildcard scope (`[.]` or `[...]`) renders nothing and records an `unsupported` result until wildcard expansion lands, and an unmanaged `AGENTS.override.md` beside a generated `AGENTS.md` emits a `codex-agents-override-shadow` warning. An unmanaged `CLAUDE.md` at whichever placement Skillset did not render emits a `claude-instructions-duplicate-root` warning; the build leaves that file untouched.

Provider toggles can make one rule unavailable to a [target](../../glossary.md#target). They do not change the rule's shared meaning or suppress its applicable adopted Agent Instructions projection.

Use [`skillset new rule`](../cli/new.md) to scaffold source and [`skillset explain`](../cli/explain.md) to trace a source rule or [generated output](../../glossary.md#generated-output) to its lock-backed destinations.

## Provenance

The root `skillset.lock` records rule source paths, destination paths, standard owner, provider consumers, hashes, deterministic aggregation, and preprocessing dependencies. Rule source units use `rule:<id>` selectors.

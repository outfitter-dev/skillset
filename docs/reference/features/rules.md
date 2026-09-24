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

## Source Contract

A rule is Markdown with optional frontmatter and a body:

```markdown
---
paths:
  - docs/**/*.md
---

# Documentation guidance

Keep public behavior aligned with its canonical contract.
```

The generated [rule-frontmatter schema and example](../schemas/README.md) own the exact fields. `paths` supplies Claude path scoping and helps derive scoped Codex [destinations](../../glossary.md#destination). Shared metadata and provider blocks follow the [frontmatter](../../configuration/frontmatter.md) and [target override](../../configuration/target-overrides.md) contracts.

Directory names under `rules/` remain literal source and output path segments, including `[slug]`, `[...slug]`, and `(marketing)`. Only two exact segments are reserved for derived scope: `[.]` means one directory level and `[...]` means any depth. A Unicode ellipsis segment `[…]` is rejected with a rename to `[...]`; classification alone does not rewrite the mirrored Claude or Cursor path.

Rule-body expressions, partials, resolve-only references, escaping, and `skillset.preprocess: false` belong to [source preprocessing](../source/preprocessing.md). The broader path and ownership rules live in the [rule source reference](../source/rules.md).

When Agent Instructions is adopted, every applicable rule inherently contributes to the root or scoped `AGENTS.md` standard baseline. There is no workspace, plugin, or frontmatter opt-out. A candidate or retired profile produces no standard output.

## Provider Output

| Source | Claude | Codex | Cursor |
| --- | --- | --- | --- |
| `.skillset/RULES.md` | no output | bare first section of root `AGENTS.md` | unsupported (`cursor-agents-md-root`) |
| `.skillset/rules/**/*.md` | `.claude/rules/**/*.md` | root or scoped `AGENTS.md` | `.cursor/rules/**/*.mdc` |
| `.skillset/_codex/rules/**/*.rules` | n/a | `.codex/rules/**/*.rules` | n/a |
| Plugin `rules/` | n/a | n/a | plugin `rules/` |

Claude preserves path scope. Cursor translates it to Cursor rule frontmatter. Codex strips source frontmatter and combines contributing rules in deterministic source-path order. Patterns with a static directory base produce a scoped `AGENTS.md`; unscoped rules contribute to the repository root. When Codex and Agent Instructions both consume a compatible `AGENTS.md`, the standard owns one physical file and Codex is recorded as a logical delta consumer.

Codex `.rules` files are [provider-native](../../glossary.md#provider-native) command-execution policy, not rule prose. Plugin `rules/` are Cursor-native companions. Neither path is another portable rule [source root](../../glossary.md#source-root).

## Errors and Caveats

Skillset rejects invalid frontmatter, unsupported preprocessing expressions, unsafe partial paths, output collisions, unsupported symlink mode, and attempts to render Markdown rule prose as Codex `.rules`. A generated `AGENTS.md` that exceeds Codex's default project-document byte limit emits a warning; narrower path scopes avoid silent provider truncation.

Provider toggles can make one rule unavailable to a [target](../../glossary.md#target). They do not change the rule's shared meaning or suppress its applicable adopted Agent Instructions projection.

Use [`skillset new rule`](../cli/new.md) to scaffold source and [`skillset explain`](../cli/explain.md) to trace a source rule or [generated output](../../glossary.md#generated-output) to its lock-backed destinations.

## Provenance

The root `skillset.lock` records rule source paths, destination paths, standard owner, provider consumers, hashes, deterministic aggregation, and preprocessing dependencies. Rule source units use `rule:<id>` selectors.

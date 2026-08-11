---
description: Instructions define adaptive guidance metadata, path scoping, provider projections, and command-policy boundaries.
---

# Instructions

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `plugin-rules` | `implemented` | `not_applicable` | `not_applicable` | `pass_through` |
| `project-instructions` | `implemented` | `transformed` | `transformed` | `transformed` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Portable [adaptive source](../../glossary.md#adaptive-source) instructions live at `.skillset/rules/**/*.md`. They provide durable repository guidance rather than invokable skill behavior.

## Source Contract

An instruction is Markdown with optional frontmatter and a body:

```markdown
---
paths:
  - docs/**/*.md
---

# Documentation guidance

Keep public behavior aligned with its canonical contract.
```

The generated [instruction-frontmatter schema and example](../schemas/README.md) own the exact fields. `paths` supplies Claude path scoping and helps derive scoped Codex [destinations](../../glossary.md#destination). Shared metadata and provider blocks follow the [frontmatter](../../configuration/frontmatter.md) and [target override](../../configuration/target-overrides.md) contracts.

Instruction-body expressions, partials, resolve-only references, escaping, and `skillset.preprocess: false` belong to [source preprocessing](../source/preprocessing.md). The broader path and ownership rules live in the [instruction source reference](../source/instructions.md).

## Provider Output

| Source | Claude | Codex | Cursor |
| --- | --- | --- | --- |
| `.skillset/rules/**/*.md` | `.claude/rules/**/*.md` | root or scoped `AGENTS.md` | `.cursor/rules/**/*.mdc` |
| `.skillset/_codex/rules/**/*.rules` | n/a | `.codex/rules/**/*.rules` | n/a |
| Plugin `rules/` | n/a | n/a | plugin `rules/` |

Claude preserves path scope. Cursor translates it to Cursor rule frontmatter. Codex strips source frontmatter and combines contributing instructions in deterministic source-path order. Patterns with a static directory base produce a scoped `AGENTS.md`; unscoped instructions contribute to the repository root.

Codex `.rules` files are [provider-native](../../glossary.md#provider-native) command-execution policy, not instruction prose. Plugin `rules/` are Cursor-native companions. Neither path is another portable instruction [source root](../../glossary.md#source-root).

## Errors and Caveats

Skillset rejects invalid frontmatter, unsupported preprocessing expressions, unsafe partial paths, output collisions, unsupported symlink mode, and attempts to render Markdown instruction prose as Codex `.rules`. A generated `AGENTS.md` that exceeds Codex's default project-document byte limit emits a warning; narrower path scopes avoid silent provider truncation.

Provider toggles can make one instruction unavailable to a [target](../../glossary.md#target). They do not change the instruction's shared meaning.

Use [`skillset new instruction`](../cli/new.md) to scaffold source and [`skillset explain`](../cli/explain.md) to trace a source instruction or [generated output](../../glossary.md#generated-output) to its lock-backed destinations.

## Provenance

The root `skillset.lock` records instruction source paths, destination paths, target, hashes, deterministic aggregation, and preprocessing dependencies.

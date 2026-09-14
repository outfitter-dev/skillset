---
description: Defines portable instruction source, path scoping, provider destination behavior, ownership, and target-native command-policy boundaries.
---

# Instructions

Instructions are durable repository guidance authored as [source units](../../glossary.md#source-unit) under `.skillset/rules/**/*.md`. They are not invokable skills. Skillset renders the inherent Agent Instructions baseline and each enabled provider's supported instruction form from the same source.

For the current field set and override shape, use the generated [instruction frontmatter schema](../schemas/0.1.0/instruction-frontmatter.schema.json) and [example](../examples/instruction-frontmatter.yaml). The [instructions feature page](../features/instructions.md) owns the current support summary.

## Authoring

An instruction is Markdown with optional frontmatter and a body:

```markdown
---
paths:
  - docs/**/*.md
---

# Documentation guidance

- Keep public behavior aligned with its canonical contract.
```

Top-level `paths` scopes an instruction to matching repository paths. Instruction frontmatter can also carry shared metadata, explicit provider blocks, and provider toggles. A toggle such as `codex: false` suppresses only that provider's logical projection; it does not remove the instruction from the inherent Agent Instructions output or hide the resulting `AGENTS.md` from standards-compatible clients. [Target](../../glossary.md#target)-specific fields override shared intent only for that target; they do not create a second portable meaning.

Use `skillset new instruction <name>` to preview a normalized source file under `.skillset/rules/`. `--in <plugin>` selects an existing plugin container, and `--yes` confirms the write. The command refuses collisions and does not run a [build](../../glossary.md#build). See the generated [`new` command reference](../cli/new.md) for the complete CLI contract.

Instruction bodies support [preprocessing](preprocessing.md). Set `skillset.preprocess: false` when recognized Skillset expressions must remain literal.

## Destination behavior

Applicable instruction source always contributes to the adopted Agent Instructions [destination](../../glossary.md#destination). Enabled targets add their provider-native files or consume that compatible standard-owned output.

| Authored source | Projection | Behavior |
| --- | --- | --- |
| `.skillset/rules/**/*.md` | Root or scoped `AGENTS.md` | Inherent Agent Instructions output. Strips source-only frontmatter and combines contributing rules deterministically. |
| Unscoped `.skillset/rules/**/*.md` | Root `CLAUDE.md` | Claude provider output. Combines unscoped instruction bodies once in deterministic source order with source-boundary comments. |
| Path-scoped `.skillset/rules/**/*.md` | `.claude/rules/**/*.md` | Claude provider output. Preserves the relative hierarchy and `paths` frontmatter. |
| `.skillset/rules/**/*.md` | `.cursor/rules/**/*.mdc` | Cursor provider output. Preserves the relative hierarchy and translates path scope into Cursor rule frontmatter. |
| `.skillset/rules/**/*.md` | Logical Codex consumer of standard-owned `AGENTS.md` | Adds Codex consumption provenance when enabled without creating a second physical instruction file. |

Agent Instructions destinations follow the static base of `paths`. A pattern such as `docs/**/*.md` contributes to `docs/AGENTS.md`. When a pattern has no static base, Skillset inspects matching repository files and uses their lowest common directory, which may be the repository root. Unscoped rules contribute to root `AGENTS.md` and, when Claude is enabled, root `CLAUDE.md`.

Root `CLAUDE.md` is independent of Claude's configurable project directory. An unscoped instruction appears in that aggregate instead of also being duplicated under `.claude/rules/`; path-scoped instructions retain their separate native files.

When multiple rules reach one Agent Instructions destination, Skillset concatenates them in source-path order. Each section begins with a deterministic source-boundary comment so provenance remains visible without leaking source frontmatter into the instruction body. Skillset does not use `.codex/AGENTS.md` as a default project-instruction location.

Codex may silently truncate an `AGENTS.md` beyond its configured project-document byte limit. Build and output checks warn when generated guidance exceeds the default 32 KiB limit. Prefer narrower path-scoped instructions that land in nested directories, or deliberately adjust the provider's own configuration.

## Ownership and collisions

Generated instruction files are recorded in the root `skillset.lock`. An unmanaged file at a required instruction destination blocks the initial build; Skillset does not silently replace it or treat provider selection as a way to suppress the inherent `AGENTS.md` baseline. Use the repository [adoption workflow](../../guides/importing.md) to move existing guidance into `.skillset/rules/`, or move the conflicting file aside and review the generated result. Once a lock establishes ownership, ordinary managed-edit backup, reconciliation, and restore rules follow [Output Safety](../features/output-safety.md).

`codex: symlink` is not supported. A symlink to a Claude rule would expose Claude-specific frontmatter as Codex instructions and would bypass normal generated ownership.

## Instructions are not command policy

Codex `.rules` files describe target-native command execution policy, not Markdown instruction prose. Author those files explicitly under `.skillset/_codex/rules/**/*.rules` when that native surface is required. They mirror to `.codex/rules/**/*.rules`; portable instructions continue to render through `AGENTS.md`.

The same boundary applies to plugin-native companions: provider-specific plugin `rules/` content is an explicit island, not another location for workspace instruction source. Use the [workspace layout](workspace-layout.md#provider-native-islands) to choose the correct owner.

---
description: Defines portable instruction source, path scoping, provider destination behavior, ownership, and target-native command-policy boundaries.
---

# Instructions

Instructions are durable repository guidance authored as [source units](../../glossary.md#source-unit) under `.skillset/rules/**/*.md`. They are not invokable skills. Skillset keeps the source hierarchy and [renders](../../glossary.md#render) each enabled provider's supported instruction form.

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

Top-level `paths` scopes an instruction to matching repository paths. Instruction frontmatter can also carry shared metadata, explicit provider blocks, and provider toggles. For example, set `codex: false` when an instruction is intentionally unavailable to Codex. [Target](../../glossary.md#target)-specific fields override shared intent only for that target; they do not create a second portable meaning.

Use `skillset new instruction <name>` to preview a normalized source file under `.skillset/rules/`. `--in <plugin>` selects an existing plugin container, and `--yes` confirms the write. The command refuses collisions and does not run a [build](../../glossary.md#build). See the generated [`new` command reference](../cli/new.md) for the complete CLI contract.

Instruction bodies support [preprocessing](preprocessing.md). Set `skillset.preprocess: false` when recognized Skillset expressions must remain literal.

## Destination behavior

Each enabled target writes a concrete [destination](../../glossary.md#destination) in that provider's native repository shape.

| Authored source | Destination | Behavior |
| --- | --- | --- |
| `.skillset/rules/**/*.md` | `.claude/rules/**/*.md` | Preserves the relative hierarchy and `paths` frontmatter. Unscoped rules render without frontmatter. |
| `.skillset/rules/**/*.md` | `.cursor/rules/**/*.mdc` | Preserves the relative hierarchy and translates path scope into Cursor rule frontmatter. |
| `.skillset/rules/**/*.md` | `AGENTS.md` at the repository root or a derived scoped directory | Strips source-only frontmatter and combines contributing rules deterministically. |

Codex destinations follow the static base of `paths`. A pattern such as `docs/**/*.md` contributes to `docs/AGENTS.md`. When a pattern has no static base, Skillset inspects matching repository files and uses their lowest common directory. Unscoped rules contribute to the root `AGENTS.md`.

When multiple rules reach one Codex destination, Skillset concatenates them in source-path order. Each section begins with a deterministic source-boundary comment so provenance remains visible without leaking source frontmatter into the instruction body. Skillset does not use `.codex/AGENTS.md` as a default project-instruction location.

Codex may silently truncate an `AGENTS.md` beyond its configured project-document byte limit. Build and output checks warn when generated guidance exceeds the default 32 KiB limit. Prefer narrower path-scoped instructions that land in nested directories, or deliberately adjust the provider's own configuration.

## Ownership and collisions

Generated instruction files are recorded in the root `skillset.lock`. If a confirmed build must replace an unmanaged `AGENTS.md`, Skillset first creates recovery evidence and reports the restore identifier. Move hand-written guidance into `.skillset/rules/` only when you intend Skillset to own that destination; otherwise change the source scope or target selection.

`codex: symlink` is not supported. A symlink to a Claude rule would expose Claude-specific frontmatter as Codex instructions and would bypass normal generated ownership.

## Instructions are not command policy

Codex `.rules` files describe target-native command execution policy, not Markdown instruction prose. Author those files explicitly under `.skillset/_codex/rules/**/*.rules` when that native surface is required. They mirror to `.codex/rules/**/*.rules`; portable instructions continue to render through `AGENTS.md`.

The same boundary applies to plugin-native companions: provider-specific plugin `rules/` content is an explicit island, not another location for workspace instruction source. Use the [workspace layout](workspace-layout.md#provider-native-islands) to choose the correct owner.

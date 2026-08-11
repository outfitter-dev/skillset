---
description: Provider source defines native input paths, pass-through validation, output ownership, and cross-target isolation.
---

# Provider Source

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `target-native-islands` | `implemented` | `pass_through` | `pass_through` | `pass_through` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

[Provider-native](../../glossary.md#provider-native) source is a [target-native island](../../glossary.md#target-native-island): an explicit source area for native files that should be mirrored to one provider without being presented as a portable Skillset concept.

## Source Contract

Project provider source uses one provider-scoped directory beneath the `.skillset/` [source root](../../glossary.md#source-root):

```text
.skillset/_claude/** -> .claude/**
.skillset/_codex/**  -> .codex/**
.skillset/_cursor/** -> .cursor/**
```

Plugin provider source uses the same `_claude/`, `_codex/`, or `_cursor/` directory inside `.skillset/plugins/<plugin>/` and mirrors into only that plugin's matching provider bundle. Provider-native feature owners such as plugin `hooks/hooks.json`, `.mcp.json`, `.app.json`, or Claude plugin `agents/` use their documented component paths instead.

A provider-source file may carry source frontmatter for preprocessing, but it may not declare `claude`, `codex`, `cursor`, or `targets` overrides because its path already selects the target. [Workspace layout](../source/workspace-layout.md) owns placement, and [source preprocessing](../source/preprocessing.md) owns expressions and dependencies.

## Provider Output

| Source | Managed [destination](../../glossary.md#destination) | Scope |
| --- | --- | --- |
| `.skillset/_claude/**` | `.claude/**` | Claude project files only |
| `.skillset/_codex/**` | `.codex/**` | Codex project files only |
| `.skillset/_cursor/**` | `.cursor/**` | Cursor project files only |
| Plugin `_provider/**` | matching provider plugin bundle | Current plugin and provider only |

Target `projectRoot` configuration can replace the default project dotfolder. Skillset claims individual generated files, not the entire provider directory, and records them in the root lock.

Known text and structured files are preprocessed and then parsed or schema-validated where their format has a contract. Unknown text and binary files copy byte-for-byte. No provider-source file may leak into another target.

Codex `.rules` files are command-execution policy and are accepted only from `.skillset/_codex/rules/**/*.rules`. Portable instruction prose belongs in `.skillset/rules/**/*.md` and renders to [provider-specific instruction surfaces](instructions.md); Codex plugin `.rules` are unsupported.

| Portable source | Claude | Codex | Cursor |
| --- | --- | --- | --- |
| `<source-root>/rules/**/*.md` | `.claude/rules/**/*.md` | `AGENTS.md` | `.cursor/rules/**/*.mdc` |

That portable source renders to Claude `.claude/rules/**/*.md`, Codex `AGENTS.md`, and Cursor `.cursor/rules/**/*.mdc`; provider source remains the escape hatch for behavior that cannot share that contract.

## Errors and Caveats

Skillset rejects traversal outside the provider-source or destination root, cross-target routing, unmanaged destination collisions, conflicting feature output, unsupported provider overrides, malformed known structured output, project-root/output-root overlap, and unsupported Codex `.rules` locations.

Opaque pass-through preserves provider truth but provides no portable semantic validation. Prefer an [adaptive source](../../glossary.md#adaptive-source) feature when Skillset has a shared contract, and keep native files only for genuine provider differences.

## Provenance

The root `skillset.lock` records source and destination paths, target, hashes, preprocessing dependencies, and whether each file was opaque or structurally validated. [`skillset diff`](../cli/diff.md), [`skillset list`](../cli/list.md), and [`skillset explain`](../cli/explain.md) expose those file-level ownership records.

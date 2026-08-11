---
description: Adopts supported provider-native material into canonical Skillset source without overwriting existing source or changing runtime configuration.
---

# Import Existing Work

Importing turns selected [provider-native](../glossary.md#provider-native) material into reviewable [canonical source](../glossary.md#canonical-source). Choose the workflow by scope: survey a whole repository with `init --adopt`, or import one known skill or plugin with `import`.

## Survey a repository

Use this path when an existing repository may contain several provider directories, skills, plugins, or instruction files.

```bash
bunx @skillset/cli init
```

The preview reports setup and adoption candidates. If you do not want to adopt them, a plain confirmed initialization scaffolds Skillset without importing them:

```bash
bunx @skillset/cli init --yes
```

If you do want to adopt surveyed material, do not scaffold first. Select a stable candidate id or explicitly choose all candidates, then confirm setup and adoption together:

```bash
bunx @skillset/cli init --adopt all --yes
```

Adoption preserves originals, stages imported source under `.skillset/`, validates it, runs an isolated [projection](../glossary.md#projection), and records an audit report. It does not write live provider output. Conflicting identities, versions, portable metadata, or divergent source block instead of being merged by name alone.

Review the exact route in the generated [`init` reference](../reference/cli/init.md).

## Import one explicit source

Use direct import when you already know the path to one skill, a skill collection, one plugin, or a plugin collection:

```bash
bunx @skillset/cli import /path/to/SKILL.md
bunx @skillset/cli import /path/to/plugin
```

Direct import writes source immediately; it has no `--yes` preview mode. Skillset stages and writes each imported [source unit](../glossary.md#source-unit) separately and refuses to overwrite an existing source path. During a collection import, an earlier unit can remain written if a later unit fails. If a directory is ambiguous, use `--kind` as documented in the generated [`import` reference](../reference/cli/import.md).

Provider shortcuts are an explicit request to inspect a known local provider origin:

```bash
bunx @skillset/cli import claude
```

Use them deliberately. Import does not silently scan user-level provider locations during ordinary [build](../glossary.md#build) or check operations.

## Preserve imported material

A skill import treats the containing skill directory as the unit, even when the selected path is its `SKILL.md`. Sibling `references/`, `scripts/`, `assets/`, `agents/`, and other sidecars are copied into canonical source with it. Collection imports follow linked skill directories but de-duplicate identical real paths.

Plugin imports accept Skillset source plugins and supported Claude, Codex, or Cursor native plugin directories. Native manifests are preserved, and Skillset synthesizes a minimal source `skillset.yaml` when the imported plugin has no source config.

Import preserves recognized source frontmatter, provider-native fields, and unknown fields instead of silently dropping them. Review the report's copied files, inferred source fields, preserved provider-native fields, unsupported fields, warnings, and next checks before building. These categories describe what Skillset understood and what still needs human judgment; they do not claim every preserved field is portable.

## Review what became source

After either workflow:

1. Inspect the new `.skillset/` files and any reported transformations or preserved [target-native islands](../glossary.md#target-native-island).
2. Resolve lint, identity, reference, or [unsupported-destination diagnostics](../development/features/render-results.md#diagnostics).
3. Preview the first build with `bunx @skillset/cli build`.
4. Confirm it with `bunx @skillset/cli build --yes`.
5. Run `bunx @skillset/cli check --only outputs` and review the generated diff.

Provider-specific material may remain explicit rather than being forced into a fake portable abstraction. The [support matrix](../reference/support-matrix.md) shows current support, and [ADR-0024](../adrs/0024-one-action-repo-adoption.md) records the adoption rationale for the [workspace](../glossary.md#workspace) workflow.

If import refuses a path or adoption reports a conflict, follow [troubleshooting](../troubleshooting.md) before changing source by hand.

Importing changes repository source only. [Activation](../glossary.md#activation), installation, trust, and user-level provider configuration remain separate workflows.

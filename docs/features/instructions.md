# Instructions

Feature id: `instructions`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Instructions are durable repo guidance authored under `.skillset/rules/**/*.md`. Codex `.rules` files are a separate target-native command policy surface under `.skillset/_codex/rules/**/*.rules`.

## Authoring

Instruction Markdown may include `name`, `dialect`, top-level `paths` for Claude path scoping, common `skillset` metadata, `supports`, and explicit provider target blocks such as `claude`, `codex`, and `cursor`. The active frontmatter contract is generated from `@skillset/schema`; see [schema reference](../reference/schemas/README.md) and [instruction frontmatter examples](../reference/examples/instruction-frontmatter.yaml) for the current field set and provider override shape. Bodies support preprocessing through nested `{{this.<field>}}` frontmatter references, instruction variables such as `{{skillset.repo_root}}`, source context such as `{{skillset.source_path}}` and `{{parent.tree depth:2}}`, triple-brace literal escapes such as `{{{this.title}}}`, path partials via `{{shared:path.md}}`, `{{plugin:path.md}}`, or a path relative to the source file, and named partials via `{{> intro}}`. Set `skillset.preprocess: false` when literal braces should be preserved.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `<source-root>/rules/**/*.md` | `.claude/rules/**/*.md` | derived `AGENTS.md` files | `portable` / `implemented` | Claude keeps `paths`; Codex strips frontmatter and concatenates deterministic source sections. |
| `<source-root>/_codex/rules/**/*.rules` | n/a | `.codex/rules/**/*.rules` | `target_native` / `implemented` | Execution policy, not instruction prose. |

## Diagnostics

- Reject instruction Markdown outside `.skillset/rules/`.
- Reject unmanaged `AGENTS.md` collisions before writing.
- Warn when a generated `AGENTS.md` exceeds Codex's default `project_doc_max_bytes`.
- Reject unknown `skillset.*` variables, missing `this.*` fields, unsafe partial paths, and unsupported Codex symlink mode.
- Treat instruction Markdown rendering to Codex `.rules` as lossy and unsupported.

## Provenance

Instruction outputs are tracked in the root `skillset.lock` with source paths, output paths, hashes, target, and preprocessing dependencies. `skillset explain` works for both source instruction files and generated outputs.

## Tests and Fixtures

Fixtures cover canonical source paths, old-path rejection, path-derived Codex destinations, deterministic concatenation, target opt-outs, variable rendering, unmanaged collisions, stale output checks, size warnings, and symlink rejection.

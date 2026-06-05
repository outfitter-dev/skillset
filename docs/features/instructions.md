# Instructions

Feature id: `instructions`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Instructions are durable repo guidance authored under `.skillset/instructions/**/*.md`. The legacy `.skillset/rules/**/*.md` path remains a compatibility alias that warns and emits the same output.

## Authoring

Instruction Markdown may include `paths` frontmatter for Claude path scoping and top-level `claude` / `codex` target toggles. Bodies support preprocessing through `{{this.<field>}}`, instruction variables such as `{{skillset.repo_root}}`, and partials via `{{> shared:path.md}}`, `{{> plugin:path.md}}`, or a path relative to the source file. Set `skillset.preprocess: false` when literal braces should be preserved.

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `.skillset/instructions/**/*.md` | `.claude/rules/**/*.md` | derived `AGENTS.md` files | `portable` / `implemented` | Claude keeps `paths`; Codex strips frontmatter and concatenates deterministic source sections. |
| `.skillset/rules/**/*.md` | same | same | `compat_alias` / `implemented` | Warned; both directories with content fail as ambiguous. |
| `.skillset/src/codex/rules/**/*.rules` | n/a | `.codex/rules/**/*.rules` | `target_native` / `implemented` | Execution policy, not instruction prose. |

## Diagnostics

- Reject ambiguous simultaneous `instructions/` and `rules/` source.
- Reject unmanaged `AGENTS.md` collisions before writing.
- Warn when a generated `AGENTS.md` exceeds Codex's default `project_doc_max_bytes`.
- Reject unknown `skillset.*` variables, missing `this.*` fields, unsafe partial paths, and unsupported Codex symlink mode.
- Treat instruction Markdown lowering to Codex `.rules` as lossy and unsupported.

## Provenance

Instruction outputs are tracked in the root `.skillset.lock` with source paths, output paths, hashes, target, and preprocessing dependencies. `skillset explain` works for both source instruction files and generated outputs.

## Tests and Fixtures

Fixtures cover canonical and compatibility source paths, path-derived Codex destinations, deterministic concatenation, target opt-outs, variable rendering, unmanaged collisions, stale output checks, size warnings, and symlink rejection.

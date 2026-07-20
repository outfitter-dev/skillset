# Provider Source

<!-- skillset:feature-support:start -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `target-native-islands` | `implemented` | `pass_through` | `pass_through` | `pass_through` |
<!-- skillset:feature-support:end -->

Current internal feature id: `target-native-islands`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Provider source is the explicit source area for native provider files that should be mirrored to provider dotfolders without pretending to be portable Skillset concepts. It preserves provider truth while keeping generated output reviewable and locked. The current registry id remains `target-native-islands` until a later schema migration changes internal selectors.

## Authoring

Project-level provider source uses explicit provider directories:

```text
<source-root>/_claude/** -> .claude/**
<source-root>/_codex/**  -> .codex/**
<source-root>/_cursor/** -> .cursor/**
```

`<source-root>` is `.skillset/`. Plugin-level native pass-through remains under plugin source paths such as `<source-root>/plugins/<plugin>/hooks/hooks.json`, `<source-root>/plugins/<plugin>/.mcp.json`, `<source-root>/plugins/<plugin>/.app.json`, and Claude plugin `agents/`.

## Support Table

| Source or surface | Claude | Codex | Cursor | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `<source-root>/_claude/**` | `.claude/**` | n/a | n/a | `target_native` / `implemented` | Project-level Claude native mirror; `claude.projectRoot` can override `.claude`. |
| `<source-root>/_codex/**` | n/a | `.codex/**` | n/a | `target_native` / `implemented` | Project-level Codex native mirror; `codex.projectRoot` can override `.codex`. |
| `<source-root>/_cursor/**` | n/a | n/a | `.cursor/**` | `target_native` / `implemented` | Project-level Cursor native mirror; `cursor.projectRoot` can override `.cursor`. |
| `<source-root>/_codex/rules/**/*.rules` | n/a | `.codex/rules/**/*.rules` | n/a | `target_native` / `implemented` | Codex command execution policy, not instruction prose. |
| `<source-root>/plugins/<plugin>/_claude/**` | Claude plugin bundle | n/a | n/a | `target_native` / `implemented` | Mirrors only when Claude plugin output is active. |
| `<source-root>/plugins/<plugin>/_codex/**` | n/a | Codex plugin bundle | n/a | `target_native` / `implemented` | Mirrors only when Codex plugin output is active; Codex plugin `.rules` remains unsupported. |
| `<source-root>/plugins/<plugin>/_cursor/**` | n/a | n/a | Cursor plugin bundle | `target_native` / `implemented` | Mirrors only when Cursor plugin output is active. |
| `<source-root>/rules/**/*.md` | `.claude/rules/**/*.md` | `AGENTS.md` | n/a | `portable` / `implemented` | Durable repo guidance; not a provider source. |
| `.codex/AGENTS.md` default guidance | n/a | n/a | n/a | `unsupported` | Codex project guidance belongs in `AGENTS.md` files at repo/scoped directories. |

## Target Rendering

Provider source should mirror only into the matching target root. It must not leak into another provider, and confirmed builds must back up unmanaged target-file collisions before replacing them. Project provider-source files are tracked as file-level workspace-managed output in the root `skillset.lock`; `skillset build` must not claim or delete the whole `.claude/`, `.codex/`, or `.cursor/` directory. Known structured files should be validated after preprocessing where the target requires a schema. Unknown files can be opaque pass-through only when path safety, ownership, and lock provenance are clear.

Codex `.rules` files are execution policy for shell-command decisions. They are not `<source-root>/rules` and must not receive prose instruction rendering. The correct portable instruction path remains `<source-root>/rules/**/*.md` to Claude `.claude/rules/**/*.md` and Codex `AGENTS.md`. Codex `.rules` pass-through is accepted only from `<source-root>/_codex/rules/**/*.rules`; project `.rules` elsewhere and all Codex plugin `.rules` fail loudly.

Provider source Markdown may carry source frontmatter for preprocessing, but it may not carry `claude`, `codex`, `cursor`, or `targets` overrides because the path already scopes the target. Known text and structured files use the SET-22 preprocessing and validation boundary; unknown and binary files copy byte-for-byte.

## Diagnostics

- Reject paths that traverse outside the provider-source directory or generated target root.
- Reject attempts to mirror a provider source into the wrong target.
- Refuse unmanaged destination collisions.
- Validate known structured output after preprocessing, including TOML/JSON/YAML where applicable. Current generated JSON, YAML, Markdown, TOML utility output, and locks are parser-validated; opaque copied sidecars remain byte-for-byte.
- Treat instruction-to-`.rules` rendering as lossy and unsupported.

## Provenance

Locks record provider-source paths, generated output paths, target provider, hashes, preprocessing dependencies, and whether a file was copied opaquely or structurally validated. `skillset diff`, `skillset list`, and `skillset explain` read those lock-backed entries so project provider-source files are visible without treating target project directories as generated roots.

## Tests and Fixtures

Fixtures cover Claude, Codex, and Cursor project provider source, Codex `.rules` pass-through, unmanaged collision backups, project-root/output-root overlap refusal, binary copy, plugin-local provider source, unknown plugin owners, no cross-target leakage, and explain/list provenance.

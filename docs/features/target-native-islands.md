# Target-Native Islands

Feature id: `target-native-islands`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Target-native islands are explicit source areas for native Claude or Codex files that should be mirrored to target dotfolders without pretending to be portable Skillset concepts. They preserve target truth while keeping generated output reviewable and locked.

## Authoring

Project-level islands use explicit target directories:

```text
.skillset/src/claude/** -> .claude/**
.skillset/src/codex/**  -> .codex/**
```

Plugin-level native pass-through remains under plugin source paths such as `.skillset/plugins/<plugin>/hooks/hooks.json`, `.skillset/plugins/<plugin>/.mcp.json`, `.skillset/plugins/<plugin>/.app.json`, and Claude plugin `agents/`.

## Support Table

| Source or surface | Claude | Codex | Status | Notes |
| --- | --- | --- | --- | --- |
| `.skillset/src/claude/**` | `.claude/**` | n/a | `target_native` / `implemented` | Project-level Claude native mirror; `claude.projectRoot` can override `.claude`. |
| `.skillset/src/codex/**` | n/a | `.codex/**` | `target_native` / `implemented` | Project-level Codex native mirror; `codex.projectRoot` can override `.codex`. |
| `.skillset/src/codex/rules/**/*.rules` | n/a | `.codex/rules/**/*.rules` | `target_native` / `implemented` | Codex command execution policy, not instruction prose. |
| `.skillset/src/plugins/<plugin>/claude/**` | Claude plugin bundle | n/a | `target_native` / `implemented` | Mirrors only when Claude plugin output is active. |
| `.skillset/src/plugins/<plugin>/codex/**` | n/a | Codex plugin bundle | `target_native` / `implemented` | Mirrors only when Codex plugin output is active; Codex plugin `.rules` remains unsupported. |
| `.skillset/instructions/**/*.md` | `.claude/rules/**/*.md` | `AGENTS.md` | `portable` / `implemented` | Durable repo guidance; not a target-native island. |
| `.codex/AGENTS.md` default guidance | n/a | n/a | `unsupported` | Codex project guidance belongs in `AGENTS.md` files at repo/scoped directories. |

## Target Rendering

Target-native islands should mirror only into the matching target root. They must not leak into the other provider, and confirmed builds must back up unmanaged target-file collisions before replacing them. Project islands are tracked as file-level workspace-managed output in the root `.skillset.lock`; `skillset build` must not claim or delete the whole `.claude/` or `.codex/` directory. Known structured files should be validated after preprocessing where the target requires a schema. Unknown files can be opaque pass-through only when path safety, ownership, and lock provenance are clear.

Codex `.rules` files are execution policy for shell-command decisions. They are not `.skillset/instructions` and must not receive prose instruction rendering. The correct portable instruction path remains `.skillset/instructions/**/*.md` to Claude `.claude/rules/**/*.md` and Codex `AGENTS.md`. Codex `.rules` pass-through is accepted only from `.skillset/src/codex/rules/**/*.rules`; project `.rules` elsewhere and all Codex plugin `.rules` fail loudly.

Target-native island Markdown may carry source frontmatter for preprocessing, but it may not carry `claude`, `codex`, or `targets` overrides because the path already scopes the target. Known text and structured files use the SET-22 preprocessing and validation boundary; unknown and binary files copy byte-for-byte.

## Diagnostics

- Reject paths that traverse outside the source island or generated target root.
- Reject attempts to mirror a target-native island into the wrong target.
- Refuse unmanaged destination collisions.
- Validate known structured output after preprocessing, including TOML/JSON/YAML where applicable. Current generated JSON, YAML, Markdown, TOML utility output, and locks are parser-validated; opaque copied sidecars remain byte-for-byte.
- Treat instruction-to-`.rules` rendering as lossy and unsupported.

## Provenance

Locks record native island source paths, generated output paths, target provider, hashes, preprocessing dependencies, and whether a file was copied opaquely or structurally validated. `skillset diff`, `skillset list`, and `skillset explain` read those lock-backed entries so project islands are visible without treating target project directories as generated roots.

## Tests and Fixtures

Fixtures cover Claude-only and Codex-only project islands, Codex `.rules` pass-through, unmanaged collision backups, project-root/output-root overlap refusal, binary copy, plugin-local islands, unknown plugin owners, no cross-target leakage, and explain/list provenance.

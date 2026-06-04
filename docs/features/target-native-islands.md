# Target-Native Islands

Feature id: `target-native-islands`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Target-native islands are explicit source areas for native Claude or Codex files that should be mirrored to target dotfolders without pretending to be portable Skillset concepts. They preserve target truth while keeping generated output reviewable and locked.

## Authoring

SET-23 defines the planned project-level island shape:

```text
.skillset/src/claude/** -> .claude/**
.skillset/src/codex/**  -> .codex/**
```

Plugin-level native pass-through remains under plugin source paths such as `.skillset/plugins/<plugin>/hooks/hooks.json`, `.skillset/plugins/<plugin>/.mcp.json`, `.skillset/plugins/<plugin>/.app.json`, and Claude plugin `agents/`.

## Support Table

| Source or surface | Claude | Codex | Status | Notes |
| --- | --- | --- | --- | --- |
| `.skillset/src/claude/**` | `.claude/**` | n/a | `target_native` / `planned` | Project-level Claude native mirror. |
| `.skillset/src/codex/**` | n/a | `.codex/**` | `target_native` / `planned` | Project-level Codex native mirror. |
| `.skillset/src/codex/rules/**/*.rules` | n/a | `.codex/rules/**/*.rules` | `target_native` / `planned` | Codex command execution policy, not instruction prose. |
| `.skillset/instructions/**/*.md` | `.claude/rules/**/*.md` | `AGENTS.md` | `portable` / `implemented` | Durable repo guidance; not a target-native island. |
| `.codex/AGENTS.md` default guidance | n/a | n/a | `unsupported` | Codex project guidance belongs in `AGENTS.md` files at repo/scoped directories. |

## Target Lowering

Target-native islands should mirror only into the matching target root. They must not leak into the other provider, and they must not overwrite unmanaged target files. Known structured files should be validated after preprocessing where the target requires a schema. Unknown files can be opaque pass-through only when path safety, ownership, and lock provenance are clear.

Codex `.rules` files are execution policy for shell-command decisions. They are not `.skillset/instructions` and must not receive prose instruction lowering. The correct portable instruction path remains `.skillset/instructions/**/*.md` to Claude `.claude/rules/**/*.md` and Codex `AGENTS.md`.

## Diagnostics

- Reject paths that traverse outside the source island or generated target root.
- Reject attempts to mirror a target-native island into the wrong target.
- Refuse unmanaged destination collisions.
- Validate known structured output after preprocessing, including TOML/JSON/YAML where applicable. Current generated JSON, YAML, Markdown, TOML utility output, and locks are parser-validated; opaque copied sidecars remain byte-for-byte.
- Treat instruction-to-`.rules` lowering as lossy and unsupported.

## Provenance

Locks should record native island source paths, generated output paths, target provider, hashes, preprocessing dependencies, and whether a file was copied opaquely or structurally validated. Future `doctor` and `explain` output should distinguish portable lowering from target-native mirror behavior.

## Tests and Fixtures

SET-23 should add fixtures for Claude-only and Codex-only project islands, Codex `.rules` pass-through, collision refusal, and no cross-target leakage.

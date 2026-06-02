# AGENTS.md

This repo contains the local `skillset` compiler.

## Responsibilities

- Read portable source from a content repo's `src/` directory.
- Emit target-native plugin repositories under that repo's `dist/` directory.
- Preserve plugin boundaries across Claude and Codex outputs.
- Keep source-only `skillset` metadata out of generated artifacts.

## Commands

```bash
bun run typecheck
bun test
bun run check
```

## Constraints

- Do not publish this package or add a remote unless Matt explicitly asks.
- Do not mutate user-level Claude or Codex config.
- Do not install or symlink generated plugins into global runtime locations.
- Keep this package focused on compilation, validation, and checks.

# AGENTS.md

This repo contains the local `skillset` compiler.

## Responsibilities

- Read portable source from a content repo's `.skillset/` directory.
- Emit target-native plugin repositories under configured output roots, defaulting
  to `plugins-claude/` and `plugins-codex/`.
- Emit standalone skills under configured target skill roots, defaulting to
  `.claude/skills` and `.agents/skills`.
- Preserve plugin boundaries across Claude and Codex outputs.
- Keep source-only `skillset` metadata out of generated artifacts except for
  lightweight generated `metadata.version` and `metadata.generated` fields.
- Write deterministic `.skillset.lock` files near generated outputs.
- Provide local source import helpers for existing plugins and skills.

## Commands

```bash
bun run typecheck
bun test
bun run check
```

## Constraints

- Do not publish this package or add a remote unless Matt explicitly asks.
- Do not mutate user-level Claude or Codex config.
- Do not install, trust, or symlink generated plugins or skills into global
  runtime locations.
- Keep this package focused on compilation, validation, import, and checks.

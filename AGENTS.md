# AGENTS.md

This repo contains the local `skillset` compiler.

The repo now self-hosts source under `.skillset/`:

- standalone internal skills for developing `skillset` itself;
- one generated `skillset` plugin for using the compiler in other source-first repos.

## Responsibilities

- Read portable source from a content repo's `.skillset/` directory.
- Emit target-native plugin repositories under configured output roots, defaulting to `plugins-claude/` and `plugins-codex/`.
- Emit standalone skills under configured target skill roots, defaulting to `.claude/skills` and `.agents/skills`.
- Preserve plugin boundaries across Claude and Codex outputs.
- Keep source-only `skillset` metadata out of generated artifacts except for lightweight generated `metadata.version` and `metadata.generated` fields.
- Write deterministic `.skillset.lock` files near generated outputs.
- Provide local source import helpers for existing plugins and skills.

## Commands

```bash
bun run skillset:build
bun run skillset:lint
bun run skillset:check
bun run typecheck
bun test
bun run check
```

`bun run check` includes the self-hosted generated-output check. If `skillset:check` reports stale output, run `bun run skillset:build`, inspect the generated diff, then rerun `bun run check`.

## Constraints

- Do not publish this package or add a remote unless Matt explicitly asks.
- Do not mutate user-level Claude or Codex config.
- Do not install, trust, or symlink generated plugins or skills into global runtime locations.
- Do not hand-edit `.claude/skills`, `.agents/skills`, `plugins-claude`, or `plugins-codex` as source truth; edit `.skillset/` and rebuild.
- Keep this package focused on compilation, validation, import, and checks.

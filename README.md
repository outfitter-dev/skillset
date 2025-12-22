# wskill

Deterministic Skill invocation for Claude Code and coding agents. Use `w/<alias>` in prompts to inject explicit Skills instead of relying on fuzzy matching.

This repo includes:

- `packages/wskill`: Bun/TypeScript CLI and shared logic (index, resolve, inject, hook runner).
- `plugins/wskill`: Claude Code plugin scaffold with hooks and slash command stubs.

## Quick start (local)

```bash
bun install      # if using dependencies later; not required today
bun run packages/wskill/src/index.ts help
```

Useful commands:

- `bun run packages/wskill/src/index.ts index` — scan for `SKILL.md` under `.claude/skills` and `~/.claude/skills` and refresh cache.
- `bun run packages/wskill/src/index.ts resolve w/frontend-design` — resolve a single alias.
- `bun run packages/wskill/src/index.ts inject "please w/frontend-design"` — emit injected markdown context.
- `bun run packages/wskill/src/index.ts hook < hook-input.json` — run the UserPromptSubmit hook path (used by plugin).
- `bun run lint` / `bun run format` — Biome + Ultracite.
- `bun run build` — bundles CLI + hook and emits `dist/types/**/*.d.ts` for npm.
- `bunx lefthook install` — install git hooks (pre-commit runs format+lint, pre-push runs tests+build).

Bun runtime is required; target is Bun 1.3+.

## Project layout

```text
PLAN.md
packages/
  wskill/
    src/...
plugins/
  wskill/
    .claude-plugin/plugin.json
    hooks/hooks.json
    scripts/wskill-hook.ts
    commands/*.md
    skills/wskill/SKILL.md
```

## Publishing to npm

```bash
cd packages/wskill
bun run build          # produces dist/ and dist/types
npm publish --access public
```

The package is Bun-targeted (`engines.bun >= 1.0.0`) with CLI entry at `dist/index.js` and type declarations at `dist/types/index.d.ts`.

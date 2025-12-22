# Repository Guidelines

## Project Structure & Module Organization

- `packages/core/` — Core functionality: indexer, resolver, tokenizer, format, cache, config modules
- `packages/shared/` — Shared utilities and constants
- `packages/types/` — TypeScript type definitions and interfaces
- `apps/cli/` — CLI application with command implementations (list, show, load, alias, sync, config, doctor, init)
- `plugins/skillset/` — Claude Code plugin scaffold (hooks, commands, bundled skill)
- `.claude/` — Local project config/cache; `config.json` is committed, cache/logs are runtime
- `.skillset/` — Skillset cache and configuration (`.skillset/cache.json`, `.skillset/config.json`)
- Root configs: `biome.json`, `ultracite.config.json`, `lefthook.yml`, `package.json`

## Build, Test, and Development Commands

- `bun run build` (root) — clean, bundle CLI + hook, emit types to `dist/`
- `bun test` (root) — run Bun test suite
- `bun run lint` / `bun run format` — Biome lint and Ultracite format
- `bun run apps/cli/src/index.ts -- <command>` — run CLI in source (e.g., `bun run apps/cli/src/index.ts -- help`)

## Coding Style & Naming Conventions

- Language: TypeScript (strict), runtime: Bun ≥1.0
- Formatting: Biome + Ultracite (2-space indent by default). Avoid non-ASCII unless required
- Imports: prefer type-only imports where applicable; keep sorted (Biome enforces)
- File names kebab-case; tests mirror source path with `.test.ts`

## Testing Guidelines

- Framework: `bun:test`
- Scope: unit tests live alongside source (`packages/*/src/**/*.test.ts`). Add coverage for new parsing/resolution paths
- Run locally via `bun test`; keep tests deterministic (no network)

## Commit & Pull Request Guidelines

- Use concise, present-tense messages (e.g., `chore: bootstrap skillset`, `feat: add indexer TTL refresh`)
- Pre-commit hook runs format + lint; pre-push runs build + test (lefthook). Fix before committing
- PRs: short description, key changes, test results; include screenshots only if UI output changes (rare here)

## Agent-Specific Tips

- Prefer `rg` for search
- Do not hand-edit `dist/` or lockfiles; regenerate via commands
- When adding skills/config, keep `.skillset/config.json` deterministic; caches/logs should remain untracked

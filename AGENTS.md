# Repository Guidelines

## Project Structure & Module Organization

- `packages/wskill/` — Bun/TypeScript CLI and hook logic (`src/`), tests in `src/**/*.test.ts`, build artifacts in `dist/`, declarations in `dist/types/`.
- `plugins/wskill/` — Claude Code plugin scaffold (hooks, commands, bundled skill).
- `.claude/` — local project config/cache; `config.json` is committed, cache/logs are runtime.
- Root configs: `biome.json`, `ultracite.config.json`, `lefthook.yml`, `package.json`.

## Build, Test, and Development Commands

- `bun run build` (root) — clean, bundle CLI + hook, emit types to `dist/`.
- `bun test` (root) — run Bun test suite.
- `bun run lint` / `bun run format` — Biome lint and Ultracite format.
- `bun run dev -- <args>` from `packages/wskill` — run CLI in source (e.g., `bun run src/index.ts -- help`).

## Coding Style & Naming Conventions

- Language: TypeScript (strict), runtime: Bun ≥1.0.
- Formatting: Biome + Ultracite (2-space indent by default). Avoid non-ASCII unless required.
- Imports: prefer type-only imports where applicable; keep sorted (Biome enforces).
- File names kebab-case; tests mirror source path with `.test.ts`.

## Testing Guidelines

- Framework: `bun:test`.
- Scope: unit tests live alongside source (`src/**/?*.test.ts`). Add coverage for new parsing/resolution paths.
- Run locally via `bun test`; keep tests deterministic (no network).

## Commit & Pull Request Guidelines

- Use concise, present-tense messages (e.g., `chore: bootstrap wskill`, `feat: add indexer TTL refresh`).
- Pre-commit hook runs format + lint; pre-push runs build + test (lefthook). Fix before committing.
- PRs: short description, key changes, test results; include screenshots only if UI output changes (rare here).

## Agent-Specific Tips

- Prefer `rg` for search.
- Do not hand-edit `dist/` or lockfiles; regenerate via commands.
- When adding skills/config, keep `.claude/wskill/config.json` deterministic; caches/logs should remain untracked.

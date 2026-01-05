# Skillset Architecture

## Overview

Skillset is a Bun-based monorepo that exposes a CLI and core library for
discovering, resolving, and injecting skills into AI agent workflows.

```text
apps/cli  ->  packages/core  ->  packages/types
                      |              ^
                      v              |
                packages/shared  <---+
```

## Packages

- `packages/types`: Source of truth for shared types and schemas.
- `packages/shared`: Cross-cutting utilities (paths, env, logging).
- `packages/core`: Indexer, resolver, config loader, cache, formatter, hooks.
- `apps/cli`: User-facing CLI that wraps core APIs.
- `plugins/skillset`: Claude plugin scaffold.

## Core flows

### Indexing

1. `indexSkills` scans `SKILL.md` files under tool-specific roots.
2. Metadata is extracted and cached in project + user caches.

### Resolution

1. Tokens are normalized (aliases and namespaces).
2. Config mappings are applied.
3. Fuzzy matching resolves candidates.
4. A `ResolveResult` is returned to the CLI or hook runner.

### Formatting

1. Resolution output is formatted using config defaults.
2. Per-skill overrides are applied when present.
3. Output is emitted as injected context or CLI text/JSON.

## Configuration and cache

- Project config: `.skillset/config.yaml` under project root.
- User config: XDG config directory (`$XDG_CONFIG_HOME/skillset`).
- Cache: project cache at `.skillset/cache.json`, user cache in XDG cache.

## Extension points

- Hooks: `runUserPromptSubmitHook` for prompt injection.
- Tool compatibility: infer tool from skill path to filter by config tools.
- Plugins: `plugins/skillset` for Claude integrations.

## Testing

- Unit tests live alongside sources (`*.test.ts`).
- CLI E2E tests use Bun spawn with isolated XDG directories.

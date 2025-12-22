# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

wskill provides deterministic skill invocation for Claude Code and coding agents. Use `w/<alias>` syntax in prompts to inject explicit Skills instead of relying on fuzzy matching.

## Commands

```bash
# Development
bun install                    # Install dependencies
bun run packages/wskill/src/index.ts help  # Run CLI locally

# CLI commands
bun run packages/wskill/src/index.ts index           # Scan SKILL.md files, refresh cache
bun run packages/wskill/src/index.ts resolve w/foo   # Resolve single alias
bun run packages/wskill/src/index.ts inject "text"   # Parse prompt, emit injected context
bun run packages/wskill/src/index.ts hook < input.json  # Run UserPromptSubmit hook

# Quality
bun run lint                   # Biome check
bun run format                 # Ultracite fix
bun run test                   # Run tests
bun run build                  # Bundle CLI + hook, emit type declarations

# Git hooks (via lefthook)
bunx lefthook install          # Install pre-commit (format, lint) and pre-push (test, build)
```

## Architecture

### Module Pipeline

User prompt flows through: **tokenizer** -> **resolver** -> **format** -> output

1. **tokenizer** (`src/tokenizer/`) - Extracts `w/<alias>` tokens from prompts, skipping code blocks
2. **resolver** (`src/resolver/`) - Matches aliases to skills via mappings, namespace aliases, or fuzzy matching
3. **indexer** (`src/indexer/`) - Scans for `SKILL.md` files in `.claude/skills` (project/user) and plugins
4. **cache** (`src/cache/`) - Persists indexed skills at `.claude/wskill/cache.json`
5. **config** (`src/config/`) - Layered config merging (project -> project.local -> user)
6. **format** (`src/format/`) - Assembles final markdown context from resolved skills

### Skill Reference Namespaces

Skills are namespaced by source:
- `project:<name>` - From `{cwd}/.claude/skills/`
- `user:<name>` - From `~/.claude/skills/`
- `plugin:<namespace>/<name>` - From `~/.claude/plugins/`

### Plugin Integration

The `plugins/wskill/` directory contains a Claude Code plugin scaffold:
- `hooks/hooks.json` - Defines `UserPromptSubmit` hook
- `scripts/wskill-hook.ts` - Hook entrypoint calling into main package
- `commands/*.md` - Slash command definitions

### Key Types (`src/types.ts`)

- `Skill` - Indexed skill metadata (skillRef, path, name, description)
- `InvocationToken` - Parsed `w/<alias>` token (raw, alias, namespace)
- `ResolveResult` - Resolution outcome (skill found, unmatched, or ambiguous with candidates)
- `ConfigSchema` - Mode (warn/strict), mappings, namespace aliases

## Testing

```bash
cd packages/wskill
bun test                       # Run all tests
bun test resolver              # Run specific test file
bun test --watch               # Watch mode
```

## Publishing

```bash
cd packages/wskill
bun run build
npm publish --access public
```

Package exports `./dist/index.js` (CLI) and `./hook` entry for hook usage.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

skillset provides deterministic skill invocation for Claude Code and coding agents. Use `$<alias>` syntax in prompts to inject explicit Skills instead of relying on fuzzy matching.

## Commands

```bash
# Development
bun install                    # Install dependencies
bun run apps/cli/src/index.ts help  # Run CLI locally

# CLI commands
bun run apps/cli/src/index.ts load <path>       # Load skill from file
bun run apps/cli/src/index.ts alias <name> <ref>  # Create alias
bun run apps/cli/src/index.ts unalias <name>    # Remove alias
bun run apps/cli/src/index.ts sync              # Sync and refresh cache
bun run apps/cli/src/index.ts config            # Show configuration
bun run apps/cli/src/index.ts doctor            # Diagnose issues
bun run apps/cli/src/index.ts init              # Initialize project
bun run apps/cli/src/index.ts resolve $foo      # Resolve single alias

# Quality
bun run lint                   # Biome check
bun run format                 # Ultracite fix
bun run test                   # Run tests
bun run build                  # Bundle CLI + hook, emit type declarations

# Git hooks (via lefthook)
bunx lefthook install          # Install pre-commit (format, lint) and pre-push (test, build)
```

## Architecture

### Monorepo Structure

The project is organized as a Bun workspace monorepo:

- `packages/core` - Core functionality (indexer, resolver, tokenizer, format, cache, config)
- `packages/shared` - Shared utilities and constants
- `packages/types` - TypeScript type definitions
- `apps/cli` - CLI application with command implementations
- `plugins/skillset` - Claude Code plugin scaffold

### Module Pipeline

User prompt flows through: **tokenizer** -> **resolver** -> **format** -> output

1. **tokenizer** (`packages/core/src/tokenizer/`) - Extracts `$<alias>` tokens from prompts, skipping code blocks
2. **resolver** (`packages/core/src/resolver/`) - Matches aliases to skills via mappings, namespace aliases, or fuzzy matching
3. **indexer** (`packages/core/src/indexer/`) - Scans for `SKILL.md` files in `.claude/skills` (project/user) and plugins
4. **cache** (`packages/core/src/cache/`) - Persists indexed skills at `.skillset/cache.json`
5. **config** (`packages/core/src/config/`) - Layered config merging (project -> project.local -> user)
6. **format** (`packages/core/src/format/`) - Assembles final markdown context from resolved skills

### Skill Reference Namespaces

Skills are namespaced by source:
- `project:<name>` - From `{cwd}/.claude/skills/`
- `user:<name>` - From `~/.claude/skills/`
- `plugin:<namespace>/<name>` - From `~/.claude/plugins/`

### Plugin Integration

The `plugins/skillset/` directory contains a Claude Code plugin scaffold:
- `hooks/hooks.json` - Defines `UserPromptSubmit` hook
- `scripts/skillset-hook.ts` - Hook entrypoint calling into main package
- `commands/*.md` - Slash command definitions

### Key Types (`packages/types/src/index.ts`)

- `Skill` - Indexed skill metadata (skillRef, path, name, description)
- `InvocationToken` - Parsed `$<alias>` token (raw, alias, namespace)
- `ResolveResult` - Resolution outcome (skill found, unmatched, or ambiguous with candidates)
- `ConfigSchema` - Mode (warn/strict), mappings, namespace aliases

## Testing

```bash
bun test                       # Run all tests
bun test resolver              # Run specific test file
bun test --watch               # Watch mode
```

## Publishing

```bash
cd apps/cli
bun run build
npm publish --access public
```

Package exports `./dist/index.js` (CLI) and `./hook` entry for hook usage.

# skillset

Deterministic Skill invocation for Claude Code and coding agents. Use `$<alias>` in prompts to inject explicit Skills instead of relying on fuzzy matching.

This repo is organized as a Bun monorepo:

- `packages/core`: Core indexing, resolution, and injection logic
- `packages/shared`: Shared utilities and constants
- `packages/types`: TypeScript type definitions
- `apps/cli`: CLI application and commands
- `plugins/skillset`: Claude Code plugin scaffold with hooks and slash command stubs

## Quick start (local)

```bash
bun install
bun run apps/cli/src/index.ts help
```

## CLI Commands

```bash
# Core commands
skillset list                  # List all available skills
skillset show <ref>            # Show skill details
skillset load <path>           # Load skill from file

# Alias management
skillset alias <name> <ref>    # Create alias
skillset unalias <name>        # Remove alias

# System commands
skillset sync                  # Sync and refresh skill cache
skillset config                # Show current configuration
skillset doctor                # Diagnose configuration issues
skillset init                  # Initialize skillset in current project

# Development commands
skillset resolve $foo          # Resolve a single alias
skillset inject "text"         # Parse prompt and emit injected context
```

## Development Commands

```bash
# Quality
bun run lint                   # Biome check
bun run format                 # Ultracite fix
bun run test                   # Run tests
bun run build                  # Bundle CLI + hook, emit type declarations

# Git hooks (via lefthook)
bunx lefthook install          # Install pre-commit (format, lint) and pre-push (test, build)
```

Bun runtime is required; target is Bun 1.3+.

## Project layout

```text
packages/
  core/                # Core indexing, resolution, injection
    src/
      indexer/
      resolver/
      tokenizer/
      format/
      cache/
      config/
  shared/              # Shared utilities
  types/               # Type definitions
apps/
  cli/                 # CLI application
    src/
      commands/        # Command implementations
      index.ts         # CLI entry point
plugins/
  skillset/
    .claude-plugin/plugin.json
    hooks/hooks.json
    scripts/skillset-hook.ts
    commands/*.md
    skills/skillset/SKILL.md
```

## Configuration

Skills are indexed from:
- `{cwd}/.claude/skills/` - Project skills
- `~/.claude/skills/` - User skills
- `~/.claude/plugins/` - Plugin skills

Cache and configuration stored at:
- `.skillset/cache.json` - Indexed skills cache
- `.skillset/config.json` - Project configuration
- `~/.skillset/config.json` - User configuration

## Publishing to npm

```bash
cd apps/cli
bun run build          # produces dist/ and dist/types
npm publish --access public
```

The package is Bun-targeted (`engines.bun >= 1.0.0`) with CLI entry at `dist/index.js` and type declarations at `dist/types/index.d.ts`.

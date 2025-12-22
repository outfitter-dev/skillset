# Skillset Rename Plan

## Overview

Migrate `wskill` → `skillset` with new invocation patterns. This refactor touches naming, syntax, directory structure, and documentation.

## Status

| Phase | Description | Status | Dependencies |
| ----- | ----------- | ------ | ------------ |
| 0 | [Monorepo Conversion](./00-monorepo-conversion.md) | pending | none |
| 1 | [Core Naming](./01-core-naming.md) | pending | Phase 0 |
| 2 | [Invocation Syntax](./02-invocation-syntax.md) | pending | Phase 0 |
| 3 | [Directory Structure](./03-directory-structure.md) | pending | Phases 0, 1 |
| 4 | [Kit → Set Rename](./04-kit-to-set.md) | pending | Phases 0, 2 |
| 5 | [Plugin Update](./05-plugin-update.md) | pending | Phases 0-4 |
| 6 | [Documentation](./06-documentation.md) | pending | Phases 0-5, 8 |
| 7 | [Validation](./07-validation.md) | pending | Phases 0-6, 8 |
| 8 | [CLI Redesign](./08-cli-redesign.md) | pending | Phases 0-4 |

## Parallel Execution Strategy

```text
Phase 0 (Monorepo Conversion - FIRST)
         ↓
         ├──▶ Phase 1 ─────────────────────────────┐
         │                                          ├──▶ Phase 5 ──▶ Phase 6 ──▶ Phase 7
         └──▶ Phase 2 ─────────────────────────────┤
                      └──▶ Phase 4 ────────────────┤
                                                    └──▶ Phase 8 ─┘
              Phase 3 (after Phase 1) ──────────────┘
```

**Phase 0** (run first - structural foundation):
- Phase 0: Monorepo Conversion (establishes new file structure)

**Parallel Group A** (after Phase 0, run simultaneously):
- Phase 1: Core Naming (depends on Phase 0)
- Phase 2: Invocation Syntax (depends on Phase 0)

**Parallel Group B** (after Group A):
- Phase 3: Directory Structure (depends on Phases 0, 1)
- Phase 4: Kit → Set (depends on Phases 0, 2)

**Parallel Group C** (after Group B, can run in parallel):
- Phase 5: Plugin Update (depends on Phases 0-4)
- Phase 8: CLI Redesign (depends on Phases 0-4)

**Sequential** (after Groups A+B+C):
- Phase 6: Documentation
- Phase 7: Validation

## Change Summary

| Aspect | Old | New |
| ------ | --- | --- |
| Package name | `wskill` | `skillset` |
| CLI command | `wskill` | `skillset` |
| Skill invocation | `w/<alias>` | `$<alias>` |
| Namespaced | `w/namespace:alias` | `$namespace:alias` |
| Set invocation | `w/kit:name` | `$<alias>` (same as skills) or `$set:<alias>` (explicit) |
| Config paths | `.claude/wskill/` | `.skillset/` (project root) |
| User config | `~/.claude/wskill/` | `~/.skillset/` |
| Plugin dir | `plugins/wskill/` | `plugins/skillset/` |
| Structure | Flat package | Monorepo (Phase 0) |
| Core package | N/A | `@skillset/core` (Phase 0) |
| CLI package | N/A | `skillset` in `apps/cli/` (Phase 0) |

## Files Affected

### Source Code (after Phase 0 monorepo conversion)

- `apps/cli/src/cli.ts` - CLI name, descriptions, patterns
- `packages/core/src/tokenizer/index.ts` - Token regex (`w/` → `$`, optional `set:` prefix)
- `packages/core/src/tokenizer/tokenizer.test.ts` - Test patterns
- `packages/core/src/resolver/index.ts` - Namespace parsing
- `packages/core/src/resolver/resolver.test.ts` - Test patterns
- `packages/core/src/config/index.ts` - Path constants
- `packages/core/src/cache/index.ts` - Path constants
- `packages/core/src/format/index.ts` - Output headers
- `apps/cli/src/doctor.ts` - Diagnostic messages
- `packages/core/src/logger/index.ts` - Log namespace, paths
- `apps/cli/src/hook.ts` - Any references
- `packages/core/src/hooks/hook-runner.ts` - Token extraction

### Plugin (plugins/wskill/ → plugins/skillset/)

- `.claude-plugin/plugin.json`
- `hooks/hooks.json`
- `scripts/wskill-hook.ts` → `skillset-hook.ts`
- `commands/*.md`
- `skills/wskill/SKILL.md` → `skills/skillset/SKILL.md`

### Configuration (project-level)

- `.claude/wskill/` → `.claude/skillset/`
- `package.json` - bin entry

### Documentation

- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `.agents/notes/*.md` (preserve as historical reference)

## Subagent Assignment

Each phase document includes:
1. **Scope** - Exact files and patterns to modify
2. **Checklist** - Discrete tasks with verification
3. **Dependencies** - What must complete first
4. **Validation** - How to verify completion

Subagents should:
1. Read their assigned phase document
2. Complete all checklist items
3. Run phase-specific validation
4. Report completion to orchestrator

## Orchestration Commands

```bash
# Validate baseline (before Phase 0)
bun test
bun run build

# After Phase 0 (monorepo conversion)
bun install
bun run build
bun run apps/cli/src/index.ts --help

# After Phases 1-7 (naming and syntax changes)
bun test
bun run build
bun run apps/cli/src/index.ts --help
```

## Questions Resolved

1. **Invocation syntax** - Using `$<ref>` tokens in prompt text (no `$` required in CLI args)
2. **Backward compatibility** - None; `w/` support removed in Phase 2, and validation ensures no remnants
3. **Set syntax** - Uses the same `$<ref>` token as skills; `$set:<ref>` forces set resolution; collisions resolved via alias/interactive disambiguation
4. **Monorepo structure** - Bun workspaces with `packages/core` and `apps/cli` (Phase 0, runs first)
5. **Core package name** - `@skillset/core` (Phase 0)
6. **MCP server** - Scaffolded at `apps/mcp`, private until ready (Phase 0)
7. **Execution order** - Monorepo conversion (Phase 0) establishes foundation before all naming changes

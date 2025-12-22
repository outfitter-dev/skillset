# Phase 3: Directory Structure

## Scope

Rename directory paths from `.claude/wskill/` to `.skillset/` (project-root agnostic).

## Dependencies

- **Phase 0** must complete first (monorepo conversion establishes file structure)
- **Phase 1** must complete first (core naming changes)

## Path Changes

| Old | New | Notes |
| --- | --- | ----- |
| `.claude/wskill/config.json` | `.skillset/config.json` | Project root |
| `.claude/wskill/config.local.json` | `.skillset/config.local.json` | Project root |
| `.claude/wskill/cache.json` | `.skillset/cache.json` | Project root |
| `~/.claude/wskill/config.json` | `~/.skillset/config.json` | User global |
| `~/.claude/wskill/cache.json` | `~/.skillset/cache.json` | User global |
| `~/.claude/wskill/logs/` | `~/.skillset/logs/` | User global |
| `~/.claude/plugins/wskill/` | `~/.claude/plugins/skillset/` | Plugin stays in .claude |

**Note**: The `.skillset/` location is intentionally tool-agnostic (not `.claude/skillset/`) to support cross-host skill management across Claude, Codex, Copilot, etc. |

## Files to Modify

### Config Paths

| File | Change |
| ---- | ------ |
| `packages/core/src/config/index.ts:16` | `".claude", "wskill"` → `".skillset"` |
| `packages/core/src/config/index.ts:17` | `".claude", "wskill"` → `".skillset"` |
| `packages/core/src/config/index.ts:18` | `".claude", "wskill"` → `".skillset"` |

### Cache Paths

| File | Change |
| ---- | ------ |
| `packages/core/src/cache/index.ts:19` | `".claude", "wskill"` → `".skillset"` |
| `packages/core/src/cache/index.ts:20` | `".claude", "wskill"` → `".skillset"` |

### Logger Paths

| File | Change |
| ---- | ------ |
| `packages/core/src/logger/index.ts:13` | `".claude", "wskill", "logs"` → `".skillset", "logs"` |

### Doctor Plugin Detection

| File | Change |
| ---- | ------ |
| `apps/cli/src/doctor.ts:119` | `"plugins", "wskill"` → `"plugins", "skillset"` |

## Project Directory Rename

Rename the actual directories:

```bash
# Project level
mv .claude/wskill .skillset

# User level (during migration)
mv ~/.claude/wskill ~/.skillset
```

## Checklist

- [ ] Update path in `packages/core/src/config/index.ts` (3 paths)
- [ ] Update path in `packages/core/src/cache/index.ts` (2 paths)
- [ ] Update path in `packages/core/src/logger/index.ts` (1 path)
- [ ] Update path in `apps/cli/src/doctor.ts` (1 path)
- [ ] Rename `.claude/wskill/` → `.skillset/` in repo
- [ ] Update `.gitignore` if it references wskill paths

## Validation

```bash
# Directory should exist at project root
ls -la .skillset/

# No references to old path (excluding notes)
grep -r "\.claude/wskill" apps/ packages/ --include="*.ts"
grep -r '".claude", "wskill"' apps/ packages/ --include="*.ts"

# Config should load from new path
bun run apps/cli/src/index.ts doctor config
```

## Migration Notes

For existing users, they will need to:

```bash
mv ~/.claude/wskill ~/.skillset
mv .claude/wskill .skillset  # in each project
```

This could be added to `skillset init` as a migration step with auto-detection of legacy paths.

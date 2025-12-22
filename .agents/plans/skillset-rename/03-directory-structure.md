# Phase 3: Directory Structure

## Scope

Rename directory paths from `.claude/wskill/` to `.skillset/` with XDG Base Directory compliance (project-root agnostic, tool-agnostic).

## Dependencies

- **Phase 0** must complete first (monorepo conversion establishes file structure, including `packages/shared/src/paths.ts`)
- **Phase 1** must complete first (core naming changes)

## XDG Base Directory Specification

The XDG spec defines standard locations for user data. We follow this with a macOS fallback:

| XDG Variable | Linux Default | macOS Fallback | Purpose |
| ------------ | ------------- | -------------- | ------- |
| `XDG_CONFIG_HOME` | `~/.config/skillset` | `~/.skillset` | Config files |
| `XDG_DATA_HOME` | `~/.local/share/skillset` | `~/.skillset` | Persistent data |
| `XDG_CACHE_HOME` | `~/.cache/skillset` | `~/.skillset/cache` | Cache files |

**Why macOS fallback to `~/.skillset`?** macOS users expect dotfiles in home, not `.config/`. Linux users expect XDG compliance.

## Path Changes

### Project-Level Paths (unchanged across platforms)

| Old | New | Notes |
| --- | --- | ----- |
| `.claude/wskill/config.json` | `.skillset/config.json` | Project root |
| `.claude/wskill/config.local.json` | `.skillset/config.local.json` | Project root |
| `.claude/wskill/cache.json` | `.skillset/cache.json` | Project root |

### User-Level Paths (XDG-compliant)

| Old | Linux (XDG) | macOS (fallback) | Type |
| --- | ----------- | ---------------- | ---- |
| `~/.claude/wskill/config.json` | `~/.config/skillset/config.json` | `~/.skillset/config.json` | Config |
| `~/.claude/wskill/cache.json` | `~/.cache/skillset/cache.json` | `~/.skillset/cache/cache.json` | Cache |
| `~/.claude/wskill/logs/` | `~/.local/share/skillset/logs/` | `~/.skillset/logs/` | Data |
| `~/.claude/plugins/wskill/` | `~/.claude/plugins/skillset/` | `~/.claude/plugins/skillset/` | Plugin |

**Note**: The `.skillset/` location is intentionally tool-agnostic (not `.claude/skillset/`) to support cross-host skill management across Claude, Codex, Copilot, etc.

## Codex Skill Locations (for sync targets)

Codex loads skills from multiple scopes with precedence. Use these for `skillset sync` defaults and migration guidance:

| Scope | Location | Notes |
| ----- | -------- | ----- |
| REPO | `$CWD/.codex/skills` | Working directory scope |
| REPO | `$CWD/../.codex/skills` | Parent scope inside repo |
| REPO | `$REPO_ROOT/.codex/skills` | Repo root scope |
| USER | `$CODEX_HOME/skills` (default `~/.codex/skills`) | User scope |
| ADMIN | `/etc/codex/skills` | System scope |
| SYSTEM | Bundled with Codex | Built-in skills; can be overridden by higher scopes |

These locations override lower-precedence scopes when names collide.

### Environment Variable Overrides

Users can override any XDG path:

```bash
XDG_CONFIG_HOME=~/.myconfig skillset list  # Uses ~/.myconfig/skillset/
XDG_DATA_HOME=~/.mydata skillset stats     # Logs to ~/.mydata/skillset/logs/
```

## Files to Modify

### Path Resolution (centralized in @skillset/shared)

Path resolution is now centralized in `packages/shared/src/paths.ts` (see Phase 0). Core modules import path helpers instead of hardcoding paths.

| File | Change |
| ---- | ------ |
| `packages/shared/src/paths.ts` | **New file** - XDG path resolution (created in Phase 0) |

### Config Module

| File | Change |
| ---- | ------ |
| `packages/core/src/config/index.ts` | Import `getConfigDir`, `getSkillsetPaths` from `@skillset/shared` |
| `packages/core/src/config/index.ts` | Replace hardcoded `".claude", "wskill"` with `getConfigDir()` for user paths |
| `packages/core/src/config/index.ts` | Keep `.skillset/` for project paths (no XDG for project-level) |

### Cache Module

| File | Change |
| ---- | ------ |
| `packages/core/src/cache/index.ts` | Import `getCacheDir`, `getSkillsetPaths` from `@skillset/shared` |
| `packages/core/src/cache/index.ts` | Replace hardcoded `".claude", "wskill"` with `getCacheDir()` for user cache |
| `packages/core/src/cache/index.ts` | Keep `.skillset/` for project cache |

### Logger Module (replaced by Pino in @skillset/shared)

| File | Change |
| ---- | ------ |
| `packages/shared/src/logger.ts` | **New file** - Pino logger (created in Phase 0) |
| `packages/core/src/logger/` | **Remove** - Logger moves to `@skillset/shared` |

### Doctor Plugin Detection

| File | Change |
| ---- | ------ |
| `apps/cli/src/doctor.ts` | `"plugins", "wskill"` → `"plugins", "skillset"` |
| `apps/cli/src/doctor.ts` | Import `getSkillsetPaths` from `@skillset/shared` for path diagnostics |

## Project Directory Rename

Rename the actual directories:

```bash
# Project level
mv .claude/wskill .skillset

# User level (platform-dependent)
# macOS:
mv ~/.claude/wskill ~/.skillset

# Linux (XDG):
mkdir -p ~/.config/skillset ~/.local/share/skillset ~/.cache/skillset
mv ~/.claude/wskill/config.json ~/.config/skillset/
mv ~/.claude/wskill/cache.json ~/.cache/skillset/
mv ~/.claude/wskill/logs ~/.local/share/skillset/
```

## Checklist

### Shared Package (Phase 0 dependency)

- [ ] Verify `packages/shared/src/paths.ts` exists with XDG helpers
- [ ] Verify `getConfigDir()`, `getDataDir()`, `getCacheDir()`, `getSkillsetPaths()` are exported

### Core Module Updates

- [ ] Update `packages/core/src/config/index.ts` to import from `@skillset/shared`
- [ ] Update `packages/core/src/cache/index.ts` to import from `@skillset/shared`
- [ ] Remove `packages/core/src/logger/` (moved to `@skillset/shared`)

### CLI Updates

- [ ] Update `apps/cli/src/doctor.ts` plugin detection path
- [ ] Update `apps/cli/src/doctor.ts` to show resolved XDG paths in diagnostics

### Repository Structure

- [ ] Rename `.claude/wskill/` → `.skillset/` in repo
- [ ] Update `.gitignore` if it references wskill paths

## Validation

```bash
# Directory should exist at project root
ls -la .skillset/

# No references to old path (excluding notes)
grep -r "\.claude/wskill" apps/ packages/ --include="*.ts"
grep -r '".claude", "wskill"' apps/ packages/ --include="*.ts"

# Path helpers resolve correctly
bun -e "import { getSkillsetPaths } from './packages/shared/src/paths'; console.log(getSkillsetPaths())"

# Config should load from new path
bun run apps/cli/src/index.ts doctor config

# XDG override works
XDG_CONFIG_HOME=/tmp/test bun -e "import { getConfigDir } from './packages/shared/src/paths'; console.log(getConfigDir())"
# Should output: /tmp/test/skillset
```

## Migration Notes

For existing users, `skillset init` will auto-detect and migrate legacy paths:

```bash
# User runs init, which detects old paths
skillset init

# Output:
# Detected legacy paths:
#   ~/.claude/wskill/ → ~/.skillset/ (macOS)
#   .claude/wskill/ → .skillset/
# Migrate? [Y/n]
```

### Manual Migration

**macOS:**

```bash
mv ~/.claude/wskill ~/.skillset
mv .claude/wskill .skillset  # in each project
```

**Linux (XDG):**

```bash
mkdir -p ~/.config/skillset ~/.local/share/skillset ~/.cache/skillset
cp ~/.claude/wskill/config.json ~/.config/skillset/
cp ~/.claude/wskill/cache.json ~/.cache/skillset/
mv ~/.claude/wskill/logs ~/.local/share/skillset/
rm -rf ~/.claude/wskill  # after verifying migration
mv .claude/wskill .skillset  # in each project
```

### Migration Detection Logic

```typescript
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function detectLegacyPaths() {
  const home = homedir();
  const legacy = {
    user: join(home, ".claude", "wskill"),
    project: join(process.cwd(), ".claude", "wskill"),
  };

  return {
    hasLegacyUser: existsSync(legacy.user),
    hasLegacyProject: existsSync(legacy.project),
  };
}
```

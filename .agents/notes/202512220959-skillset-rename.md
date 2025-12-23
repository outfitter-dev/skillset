# Skillset Rename & Migration

**Date:** 2025-12-22
**Agent:** Claude Opus 4.5

## Summary

Migrated wskill codebase to a new repository under the `skillset` name to align with new invocation patterns and reserve the npm package name.

## Actions Taken

### 1. NPM Package Name Reservation

- Verified `skillset` was available on npm (404 = not found = available)
- Created initial package.json with:
  - `name: "skillset"`
  - `version: "0.0.1"`
  - `bin: { "skillset": "./dist/index.js" }`
- Published to npm using 1Password automation token (`4bow3fzr7ehnogrrmormumluou`)
- Command: `npm publish --access public --ignore-scripts --userconfig ~/.npmrc.skillset`
- Successfully reserved: <https://www.npmjs.com/package/skillset>

### 2. Repository Migration

**Source:** `/Users/mg/Developer/galligan/wskill` (monorepo)
**Target:** `/Users/mg/Developer/outfitter/skillset`

**Files copied from wskill root:**
- `.beads/` - Issue tracking (excluding daemon files via .beads/.gitignore)
- `.claude/` - Claude configuration
- `.agents/` - Agent notes
- `plugins/` - Plugin scaffold
- `CLAUDE.md`, `README.md`, `AGENTS.md`
- Config files: `biome.json`, `lefthook.yml`, `ultracite.config.json`
- `.gitignore`, `.gitattributes`

**Files copied from packages/wskill/:**
- `src/` - All source code
- `tsconfig.json`, `tsconfig.build.json`
- Package-level `.claude/` configs merged

**Backup created:**
- `.wskill-legacy/` contains the initial npm publish attempt files
- Added to `.gitignore`

### 3. Git Repository Setup

- Initialized git repo
- Renamed default branch from `master` to `main`
- Cleaned up files that shouldn't be tracked:
  - Removed `src/cli.ts.backup`
  - Gitignored `.claude/*/config.local.json`
  - Gitignored `.claude/*/logs/`
  - Gitignored `*.backup`

**Initial commit:** `6ec68eb` with 49 files, 4703 insertions

### 4. Beads Gitignore Configuration

The `.beads/.gitignore` properly excludes:
- `*.db`, `*.db-*` (SQLite databases)
- `daemon.lock`, `daemon.log`, `daemon.pid`, `bd.sock` (runtime files)
- `beads.*.jsonl`, `beads.*.meta.json` (merge artifacts)

And explicitly includes (source of truth):
- `issues.jsonl`
- `metadata.json`
- `config.json`

## Pending Refactor

Before pushing to GitHub (`github.com/outfitter-dev/skillset`):

1. **Naming:** `wskill` → `skillset` throughout codebase
2. **Invocation pattern:** `w/<skill>` → `$skill`
3. **Sets:** `kit` → `set` with `$$` invocation for skill sets
4. **Paths:** `.claude/wskill/` → `.claude/skillset/`
5. **Plugin:** `plugins/wskill/` → `plugins/skillset/`

## Files Modified

```text
~/Developer/outfitter/skillset/
├── .agents/
├── .beads/           # Issue tracking preserved
├── .claude/wskill/   # To be renamed to skillset
├── .wskill-legacy/   # Backup (gitignored)
├── plugins/wskill/   # To be renamed to skillset
├── src/              # Source code (needs refactor)
├── package.json      # Already updated to skillset@0.0.1
└── [config files]
```

## NPM Token Setup

For future publishes without 2FA prompts:

```bash
TOKEN=$(op item get 4bow3fzr7ehnogrrmormumluou --fields credential --reveal)
echo "//registry.npmjs.org/:_authToken=${TOKEN}" > ~/.npmrc.skillset
npm publish --access public --userconfig ~/.npmrc.skillset
```

## Next Steps

1. Create beads issues for refactor tasks
2. Execute refactor (can use subagents)
3. Run tests and build
4. Push to GitHub
5. Publish updated version to npm

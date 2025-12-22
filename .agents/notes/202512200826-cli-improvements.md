# CLI Improvements: `get` Command

**Date:** 2024-12-20
**Branch:** improvements/cli-updates

## Summary

Replaced the `resolve` command with a more powerful `get` command that supports multiple output formats, field selection, and tree visualization.

## Changes Made

### New `get` Command

Replaces the previous `resolve` command with a unified interface for retrieving skill information.

```bash
wskill get <input> [fields...] [options]
```

**Input Types:**
- Alias name (e.g., `debug`) - resolves via index
- Namespace reference (e.g., `plugin:baselayer`) - shows namespace tree
- Direct path to directory containing SKILL.md
- Direct path to SKILL.md file

**Fields:**
- `ref` - Canonical skill reference (e.g., `user:debug`)
- `path` - Absolute file path to SKILL.md
- `name` - Skill name from frontmatter
- `desc` - Description from frontmatter
- `content` - Raw markdown content
- `ns` - Namespace (user, project, plugin:xxx)

**Options:**
- `-t, --text` - Plain text output (pipe-friendly)
- `-j, --json` - JSON output
- `--tree` - Directory tree with SKILL.md heading structure

### Tree Visualization

The `--tree` flag shows a combined view of:
1. Directory structure around the skill
2. Markdown heading hierarchy inline under SKILL.md

```
└─ systematic-debugging
   ├─ SKILL.md
   │  ├─ ## The Iron Law
   │  ├─ ## The Four Phases
   │  │  ├─ ### Phase 1: Root Cause Investigation
   │  │  └─ ### Phase 2: Pattern Analysis
   │  └─ ## Quick Reference
   ├─ references/
   ├─ EXAMPLES.md
   └─ REFERENCE.md
```

SKILL.md always appears first in the listing.

### Output Modes

**Human (default):**
```bash
wskill get debug
# Systematic Debugging
# user:systematic-debugging
# Enforces evidence-based debugging...
# /Users/mg/.claude/skills/systematic-debugging/SKILL.md
```

**Text (pipe-friendly):**
```bash
wskill get debug path -t
# /Users/mg/.claude/skills/systematic-debugging/SKILL.md

wskill get debug path name -t
# path=/Users/mg/.claude/skills/systematic-debugging/SKILL.md
# name=Systematic Debugging
```

**JSON:**
```bash
wskill get debug -j
# {"ref":"user:systematic-debugging","path":"...","name":"...","desc":"...","content":"...","ns":"user"}
```

## Files Added/Modified

### New Files
- `src/tree/index.ts` - Tree building logic for directories and skills
- `src/tree/markdown.ts` - Markdown heading parser for SKILL.md
- `src/tree/object-treeify.d.ts` - Type declarations for object-treeify

### Modified Files
- `src/cli.ts` - Replaced `resolve` with `get` command, async Bun APIs
- `package.json` - Added `object-treeify` dependency

## Dependencies Added

- `object-treeify@5.0.1` - Modern tree visualization library

## Technical Notes

- All file I/O uses Bun's native APIs (`Bun.file().text()`, `Bun.file().exists()`)
- Tree functions are async to support Bun's async file operations
- Directory operations still use Node's `readdirSync`/`statSync` (no Bun equivalent)
- Markdown parser only expands ## and ### headings, skips code blocks
- SKILL.md is prioritized first in directory listings

## Usage Examples

```bash
# Basic lookup
wskill get debug

# Get just the path for piping
cat "$(wskill get debug path -t)"

# Copy content to clipboard
wskill get debug content -t | pbcopy

# View skill structure
wskill get debug --tree

# JSON for tooling
wskill get debug -j | jq -r .path

# Direct path works too
wskill get ~/.claude/skills/systematic-debugging --tree
```

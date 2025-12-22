# Phase 8: CLI Redesign

## Scope

Restructure CLI to use verb-first commands with interactive modes for better UX.

## Dependencies

- **Phases 0-4** must complete first (monorepo structure and core naming)

## Command Structure

### Old (noun-first, ambiguous)

```bash
wskill                        # List all
wskill <skill>                # Ambiguous: skill or command?
wskill kit <name>             # "kit" is both command and noun
```

### New (verb-first, clear intent)

```bash
skillset list                 # List skills/sets
skillset show <ref>           # Inspect metadata
skillset load <ref>           # Output content for injection
skillset sync                 # Sync to tool directories
skillset index                # Reindex skills
skillset init                 # Initialize
skillset alias [name] [ref]   # Create/update/list aliases
skillset unalias [name]       # Remove alias
skillset config               # Config management
skillset doctor               # Diagnostics
```

## Global Flags

Applied to any command:

```bash
--json          # Structured JSON output
--raw           # Minimal/unformatted output
--quiet / -q    # Suppress non-essential output
--verbose / -v  # Extra detail
```

## Interactive Modes

When args are omitted in a TTY, drop into interactive mode instead of erroring.

### `skillset alias` Interactive Flows

**Create alias (name provided, ref omitted):**

```bash
$ skillset alias debug

? Select skill for alias 'debug':
  ▸ project:systematic-debugging    "Evidence-based debugging workflow"
    user:quick-debug                "Fast debug checklist"
    plugin:baselayer:debug          "Baselayer debugging skill"

  Type to filter... (fzf-style)
```

**List aliases (no args):**

```bash
$ skillset alias

Current aliases:
  debug  → project:systematic-debugging
  review → user:code-review
  ship   → project:shipping-checklist
```

### `skillset unalias` Interactive Flow

**Select alias to remove (no args):**

```bash
$ skillset unalias

? Select alias to remove:
  ▸ debug  → project:systematic-debugging
    review → user:code-review
    ship   → project:shipping-checklist

  Type to filter...
```

### TTY Detection

| Context | Behavior |
| ------- | -------- |
| TTY (interactive terminal) | Show picker/prompts |
| Pipe / non-TTY | Error with usage hint |

```typescript
if (process.stdout.isTTY) {
  // Interactive mode
} else {
  // Error: "Missing argument <ref>. See --help"
}
```

## Files to Modify

### CLI Command Structure

| File | Changes |
| ---- | ------- |
| `apps/cli/src/cli.ts` | Restructure to verb-first commands |
| `apps/cli/src/commands/list.ts` | New: list command |
| `apps/cli/src/commands/show.ts` | New: show command |
| `apps/cli/src/commands/load.ts` | New: load command |
| `apps/cli/src/commands/sync.ts` | New: sync command |
| `apps/cli/src/commands/alias.ts` | Update: add interactive mode |
| `apps/cli/src/commands/unalias.ts` | Update: add interactive mode |

### Dependencies to Add

```json
{
  "dependencies": {
    "@inquirer/prompts": "^5.x",
    "ora": "^8.x"
  }
}
```

Or use existing `inquirer` if already present.

## Command Details

### `skillset list`

```bash
skillset list                    # All skills and sets
skillset list --sets             # Only sets
skillset list --skills           # Only skills (no sets)
skillset list --source project   # Filter by source
skillset list --source plugin:baselayer
```

### `skillset show <ref>`

```bash
skillset show debug              # Show skill metadata
skillset show set:designer       # Show set metadata (lists included skills)
skillset show debug --json       # JSON output
```

Output includes:
- Name, description
- Source (project/user/plugin)
- Path
- For sets: included skills

### `skillset load <ref>`

```bash
skillset load debug              # SKILL.md content
skillset load set:designer       # Expanded set (all skills concatenated)
skillset load debug --json       # Wrapped with metadata
```

Primary use: piping into hooks or other tools.

### `skillset sync`

```bash
skillset sync                    # Sync all skills to configured targets
skillset sync --target claude    # Sync to Claude only
skillset sync --target codex     # Sync to Codex only
skillset sync --dry-run          # Show what would be synced
```

Targets configured in `.skillset/config.json`:

```json
{
  "sync": {
    "targets": ["claude", "codex"],
    "claude": {
      "project": ".claude/skills",
      "user": "~/.claude/skills"
    },
    "codex": {
      "project": ".codex/skills",
      "user": "~/.codex/skills"
    }
  }
}
```

## Checklist

- [ ] Restructure `apps/cli/src/cli.ts` to verb-first
- [ ] Implement `list` command with filtering
- [ ] Implement `show` command with JSON support
- [ ] Implement `load` command for content output
- [ ] Implement `sync` command (scaffold, full implementation later)
- [ ] Add interactive mode to `alias` command
- [ ] Add interactive mode to `unalias` command
- [ ] Add global flags (--json, --raw, --quiet, --verbose)
- [ ] Add TTY detection for interactive modes
- [ ] Add fzf-style filtering using inquirer or similar

## Validation

```bash
# Commands should exist and show help
skillset list --help
skillset show --help
skillset load --help
skillset alias --help
skillset unalias --help
skillset sync --help

# List should work
skillset list
skillset list --json

# Show should display metadata
skillset show <existing-skill>
skillset show <existing-skill> --json

# Interactive mode should trigger in TTY
skillset alias test-alias  # Should show picker

# Non-TTY should error gracefully
echo "" | skillset alias test-alias  # Should error with usage
```

## Design Rationale

1. **Verb-first**: Eliminates ambiguity between skill names and commands
2. **Interactive modes**: Reduces friction, leverages indexed skills
3. **Global flags**: Consistent output control across all commands
4. **TTY detection**: Graceful degradation for scripts vs humans
5. **fzf-style filtering**: Fast skill discovery without memorizing names

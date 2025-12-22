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
--json              # Structured JSON output
--raw               # Minimal/unformatted output
--quiet / -q        # Suppress non-essential output
--verbose / -v      # Extra detail
-s / --source <ns>  # Filter by source namespace (project, user, plugin:name)
```

### Source Filter (`-s/--source`)

Variadic disambiguator for when multiple skills share the same alias:

```bash
# Ambiguous: "debug" exists in project and plugin
skillset load debug                      # Error: ambiguous, use --source

# Explicit source resolution
skillset load debug -s project           # project:debug
skillset load debug --source user        # user:debug
skillset load debug -s plugin:baselayer  # plugin:baselayer:debug

# Works with list too
skillset list -s project                 # Only project skills
skillset list -s plugin:baselayer        # Only baselayer plugin skills
```

## Environment Variables

Override CLI behavior via environment:

| Variable | Description | Example |
| -------- | ----------- | ------- |
| `SKILLSET_SOURCE` | Default source filter | `SKILLSET_SOURCE=project skillset list` |
| `SKILLSET_OUTPUT` | Default output format | `SKILLSET_OUTPUT=json skillset show debug` |
| `SKILLSET_CONFIG` | Custom config path | `SKILLSET_CONFIG=~/.myconfig/skillset skillset list` |
| `NO_COLOR` | Disable colors | `NO_COLOR=1 skillset list` (standard) |

```typescript
// Environment helpers in @skillset/shared
export const SKILLSET_ENV = {
  source: process.env.SKILLSET_SOURCE,
  output: process.env.SKILLSET_OUTPUT as "json" | "raw" | undefined,
  config: process.env.SKILLSET_CONFIG,
  noColor: process.env.NO_COLOR === "1",
};
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
| `apps/cli/src/commands/completions.ts` | New: shell completions command |

### Shared Package Additions

| File | Changes |
| ---- | ------- |
| `packages/shared/src/env.ts` | New: environment variable helpers |
| `packages/shared/src/stats.ts` | New: usage statistics logging |
| `packages/shared/src/index.ts` | Export new modules |

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

## Shell Completions

Generate shell completions for tab-complete of commands, skills, and aliases:

```bash
skillset completions bash     # Output bash completions
skillset completions zsh      # Output zsh completions
skillset completions fish     # Output fish completions
skillset completions powershell  # Output PowerShell completions
```

### Installation Examples

**Bash:**

```bash
skillset completions bash >> ~/.bashrc
# or
skillset completions bash > /etc/bash_completion.d/skillset
```

**Zsh:**

```bash
skillset completions zsh > ~/.zfunc/_skillset
# Add to .zshrc: fpath=(~/.zfunc $fpath); autoload -Uz compinit && compinit
```

**Fish:**

```bash
skillset completions fish > ~/.config/fish/completions/skillset.fish
```

### Completion Behavior

| Context | Completions |
| ------- | ----------- |
| `skillset <TAB>` | Commands (list, show, load, sync, alias, etc.) |
| `skillset show <TAB>` | Skill names and aliases |
| `skillset load <TAB>` | Skill names and aliases |
| `skillset -s <TAB>` | Source namespaces (project, user, plugin:*) |
| `skillset alias <name> <TAB>` | Skill refs for the alias target |

### Implementation

Use Commander.js built-in completion support or generate scripts manually:

```typescript
// apps/cli/src/commands/completions.ts
export function generateBashCompletions(): string {
  return `
_skillset_completions() {
  local cur=\${COMP_WORDS[COMP_CWORD]}
  local cmd=\${COMP_WORDS[1]}

  if [[ \$COMP_CWORD == 1 ]]; then
    COMPREPLY=($(compgen -W "list show load sync alias unalias config doctor index init completions" -- \$cur))
  elif [[ \$cmd == "show" || \$cmd == "load" ]]; then
    # Complete with skill names from cache
    COMPREPLY=($(compgen -W "$(skillset list --raw 2>/dev/null)" -- \$cur))
  fi
}
complete -F _skillset_completions skillset
`;
}
```

## Usage Statistics (v1)

Track skill loads in an append-only JSONL log for usage analytics:

**Location:** `~/.skillset/logs/usage.jsonl` (XDG: `~/.local/share/skillset/logs/usage.jsonl`)

### Log Format

```jsonl
{"timestamp":"2025-12-22T10:30:00Z","action":"load","skill":"project:debug","source":"cli"}
{"timestamp":"2025-12-22T10:31:15Z","action":"load","skill":"user:code-review","source":"hook"}
{"timestamp":"2025-12-22T10:32:00Z","action":"resolve","skill":"plugin:baselayer:tdd","source":"inject"}
```

### Log Entry Schema

```typescript
interface UsageEntry {
  timestamp: string;         // ISO 8601
  action: "load" | "resolve" | "inject";
  skill: string;            // Fully qualified skill ref
  source: "cli" | "hook" | "inject" | "mcp";
  duration_ms?: number;      // Optional: operation duration
}
```

### Implementation

```typescript
// packages/shared/src/stats.ts
import { join } from "node:path";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { getSkillsetPaths } from "./paths";

export function logUsage(entry: Omit<UsageEntry, "timestamp">): void {
  const paths = getSkillsetPaths();
  const logDir = paths.logs;
  const logFile = join(logDir, "usage.jsonl");

  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const record: UsageEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  appendFileSync(logFile, JSON.stringify(record) + "\n");
}
```

### Integration Points

| Location | When to Log |
| -------- | ----------- |
| `skillset load <ref>` | On successful skill load |
| Hook runner (`runUserPromptSubmitHook`) | On each skill injection |
| `skillset inject` | On each token resolution |
| MCP server (future) | On skill retrieval |

### Future: Stats Command

(Deferred to roadmap - see `.agents/plans/roadmap/stats.md`)

```bash
# Not in this phase, but planned:
skillset stats                    # Summary of usage
skillset stats --top 10           # Top 10 skills by usage
skillset stats --since 2025-12-01 # Filter by date
```

## Checklist

### CLI Structure

- [ ] Restructure `apps/cli/src/cli.ts` to verb-first
- [ ] Implement `list` command with filtering
- [ ] Implement `show` command with JSON support
- [ ] Implement `load` command for content output
- [ ] Implement `sync` command (scaffold, full implementation later)
- [ ] Add interactive mode to `alias` command
- [ ] Add interactive mode to `unalias` command

### Global Flags

- [ ] Add `--json` flag (structured JSON output)
- [ ] Add `--raw` flag (minimal/unformatted output)
- [ ] Add `--quiet / -q` flag (suppress non-essential output)
- [ ] Add `--verbose / -v` flag (extra detail)
- [ ] Add `-s / --source` flag (source filter)
- [ ] Add TTY detection for interactive modes
- [ ] Add fzf-style filtering using inquirer or similar

### Environment Variables

- [ ] Implement `SKILLSET_SOURCE` env var
- [ ] Implement `SKILLSET_OUTPUT` env var
- [ ] Implement `SKILLSET_CONFIG` env var
- [ ] Implement `NO_COLOR` support
- [ ] Add env helpers to `@skillset/shared`

### Shell Completions

- [ ] Implement `skillset completions <shell>` command
- [ ] Generate bash completions
- [ ] Generate zsh completions
- [ ] Generate fish completions
- [ ] Generate PowerShell completions

### Usage Statistics (v1)

- [ ] Create `packages/shared/src/stats.ts` with `logUsage()`
- [ ] Create `logs/` directory under XDG data path
- [ ] Log usage in `skillset load`
- [ ] Log usage in hook runner
- [ ] Log usage in inject command

## Validation

```bash
# Commands should exist and show help
skillset list --help
skillset show --help
skillset load --help
skillset alias --help
skillset unalias --help
skillset sync --help
skillset completions --help

# List should work with filters
skillset list
skillset list --json
skillset list -s project
skillset list --source plugin:baselayer

# Show should display metadata
skillset show <existing-skill>
skillset show <existing-skill> --json

# Source filter works
skillset load debug -s project
skillset load debug --source user

# Interactive mode should trigger in TTY
skillset alias test-alias  # Should show picker

# Non-TTY should error gracefully
echo "" | skillset alias test-alias  # Should error with usage

# Environment variables work
SKILLSET_SOURCE=project skillset list
SKILLSET_OUTPUT=json skillset show debug
NO_COLOR=1 skillset list

# Shell completions generate
skillset completions bash | head -20
skillset completions zsh | head -20

# Usage stats are logged
skillset load <skill>
cat ~/.skillset/logs/usage.jsonl  # macOS
cat ~/.local/share/skillset/logs/usage.jsonl  # Linux
```

## Design Rationale

1. **Verb-first**: Eliminates ambiguity between skill names and commands
2. **Interactive modes**: Reduces friction, leverages indexed skills
3. **Global flags**: Consistent output control across all commands
4. **TTY detection**: Graceful degradation for scripts vs humans
5. **fzf-style filtering**: Fast skill discovery without memorizing names

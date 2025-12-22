# CLI Redesign Notes

## Date: 2025-12-21

## Goals

- Simplify CLI ergonomics
- Shield complexity from users
- Clear mental model for discovery vs viewing

## Design Decisions

### Command Structure

```bash
# List (no positional args)
wskill                        # All skills
wskill -s project             # Filter to project source
wskill -s project user        # Multiple sources (space-separated)
wskill -s plugin:baselayer    # Specific plugin

# Show (positional args = skills)
wskill <skills...>            # Show skill(s)
wskill debug                  # Single skill
wskill debug review           # Multiple skills
wskill -s project debug       # Disambiguate by source
```

### Source Filter (`--source` / `-s`)

Variadic option supporting multiple values:

```bash
wskill -s project                         # Just project skills
wskill -s project user                    # Project + user
wskill -s plugin                          # All plugin skills
wskill -s plugin:baselayer plugin:foo     # Specific plugins
```

Maps to existing namespace prefixes:
- `project` → `project:*`
- `user` → `user:*`
- `plugin` → `plugin:*`
- `plugin:<name>` → `plugin:<name>/*`

Future-proofs for:
- `marketplace` → community skills
- `marketplace:<publisher>` → specific publisher

Also acts as disambiguator when viewing skills with same alias in multiple sources.

### Output Formats (`--output` / `-o`)

| Flag | Alias | Description |
|------|-------|-------------|
| `-o text` | `--text` | Formatted: metadata header + content (frontmatter stripped). Default in TTY |
| `-o raw` | `--raw` | Raw file(s) as-is. Good for piping |
| `-o json` | `--json` | Structured JSON |

```bash
wskill debug              # TTY default → --text
wskill debug --text       # Explicit formatted
wskill debug --raw        # cat-style, frontmatter included
wskill debug --json       # Structured output
wskill debug -o raw       # Same as --raw
```

For multiple skills:
- `--raw`: Concatenated raw files
- `--text`: Each skill formatted with separator
- `--json`: Array of skill objects

### Removed/Deprecated

- `list` command → replaced by `wskill` with no args
- `show` command → replaced by `wskill <skills...>`
- `--include` / `-i` → replaced by output format flags
- `inject` command → already deprecated, will remove

## Implementation Notes

Commander.js variadic option syntax:

```typescript
.option('-s, --source <sources...>', 'Filter by source(s)')
```

Output format resolution:

```typescript
const format = options.json ? 'json'
  : options.raw ? 'raw'
  : options.text ? 'text'
  : options.output ?? (isTTY ? 'text' : 'raw');
```

## Examples

```bash
# Discovery
wskill                                    # List all
wskill -s project                         # Filter to project
wskill -s plugin:baselayer plugin:foo     # Multiple specific plugins

# Viewing
wskill debug                              # Show skill (default view)
wskill debug --raw                        # Content only (pipeable)
wskill debug review                       # Multiple skills
wskill debug -o json                      # JSON output

# Combined
wskill -s project debug                   # Show 'debug' from project source
```

---

## Config Command

### Goals

- Easy access to edit config files
- Interactive mode for discovery
- Direct CLI for scripting/automation
- Alias management (add/remove/modify mappings)

### Command Structure

```bash
# Open/edit config
wskill config                     # Show current merged config (or interactive)
wskill config --edit              # Open in $EDITOR (default scope)
wskill config --edit --scope user # Open user config
wskill config --edit -S project   # Open project config

# Get/set values
wskill config get <key>           # Get a value
wskill config set <key> <value>   # Set a value
wskill config set maxLines 1000
wskill config set mode strict

# Alias management
wskill config alias <name> <skillRef>   # Add/update alias
wskill config alias debug project:debugging
wskill config unalias <name>            # Remove alias
wskill config aliases                   # List all aliases
```

### Scope Flag (`--scope` / `-S`)

Which config file to target:
- `project` → `{cwd}/.claude/wskill/config.json`
- `local` → `{cwd}/.claude/wskill/config.local.json` (gitignored)
- `user` → `~/.claude/wskill/config.json`

```bash
wskill config set maxLines 1000 -S user     # Set in user config
wskill config alias debug proj:debug -S project  # Project-level alias
```

### Interactive Mode

When `wskill config` is run without subcommands in a TTY:
- Show current merged config
- Or launch interactive picker (inquirer) to:
  - View/edit settings
  - Manage aliases
  - Choose which config file to edit

### Config Keys

Current schema:
- `mode` - "warn" | "strict"
- `maxLines` - number
- `showStructure` - boolean
- `mappings.<alias>` - alias → skillRef
- `namespaceAliases.<ns>` - namespace shortcuts

### Decisions

1. **`wskill config` with no args** → Interactive mode
2. **Dot notation** → Yes, for nested keys: `wskill config set show.include meta,tree`
3. **Aliases as top-level** → Yes, cleaner ergonomics

---

## Reserved Top-Level Commands

To avoid collision with skill names, these words are reserved:

| Command | Purpose |
|---------|---------|
| `config` | Configuration management |
| `alias` | Add/update an alias |
| `unalias` | Remove an alias |
| `browse` | Future: marketplace/plugin discovery |
| `index` | Refresh skill cache |
| `init` | Scaffold config files |
| `doctor` | Diagnostics |
| `completions` | Shell completions |
| `search` | Future: full-text/vector search |
| `suggest` | Future: semantic skill recommendation |
| `kit` | Load a bundled kit of skills + docs |
| `stats` | Usage statistics and analytics |

Everything else is treated as a skill reference.

### Alias Command

```bash
wskill alias <name> <skillRef>    # Add or update
wskill alias debug project:debugging
```

When alias already exists:

```
Alias 'debug' already exists → user:debugging
Overwrite with project:debugging? [y/N]
```

### Unalias Command

```bash
wskill unalias <name>             # Remove alias
wskill unalias debug
```

### Browse Command (Future)

Reserved for marketplace/discovery features:

```bash
wskill browse                     # Browse featured/marketplace
wskill browse --featured          # Claude Code featured plugins
wskill browse <query>             # Search marketplace
```

Potential integration with Claude Code's featured plugins (Git repo-based).

---

## Additional Commands

### Init Command

```bash
wskill init                       # Scaffold config files
wskill init --scope project       # Project config only
wskill init --scope user          # User config only
```

Creates `.claude/wskill/config.json` with sensible defaults.

### Completions Command

```bash
wskill completions bash           # Output bash completions
wskill completions zsh            # Output zsh completions
wskill completions fish           # Output fish completions
wskill completions powershell     # Output PowerShell completions
```

Completions should include:
- Reserved commands
- Skill names from cache
- Source names for `-s` flag

### Doctor Command

```bash
wskill doctor                     # Full diagnostic
wskill doctor config              # Config-specific diagnosis
wskill doctor <skill>             # Skill-specific diagnosis
```

Checks:
- Config file locations and validity
- Cache state and freshness
- Plugin detection
- Skill resolution paths
- Hook installation status

---

## Common Flags

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help for command |
| `--doctor` | Run diagnostics for context (e.g., `wskill config --doctor`) |
| `--version`, `-v` | Show version |
| `--verbose` | Verbose output |
| `--quiet`, `-q` | Suppress non-essential output |

---

## Piping Behavior

When stdin/stdout is piped (non-TTY):
- **Output** → Auto-switch to `--raw` format
- **List** → One skill ref per line (for `xargs`, etc.)

```bash
wskill debug | pbcopy            # Raw content to clipboard
wskill -s project | head -5      # First 5 skill refs
wskill debug review | cat        # Concatenated raw content
```

---

## Pagination

For long output in TTY mode:
- Page through results (like `less`)
- Or truncate with "show more" prompt

```bash
wskill                           # Paginated skill list in TTY
wskill debug --raw               # Paginated content view
```

Respect `$PAGER` environment variable.

---

## Search (Future)

### Full-Text Search

```bash
wskill search <query>            # Search skill content
wskill search "error handling"   # Find skills mentioning phrase
wskill search -s plugin <query>  # Search within source
```

### Vector Search (Future)

```bash
wskill search --semantic <query> # Semantic similarity search
wskill search --semantic "how to debug TypeScript"
```

Would require:
- Embedding generation for skill content
- Vector index storage (local SQLite with vector ext?)
- Periodic re-indexing

### Suggest Command (Future)

Semantic search that returns the single best recommendation:

```bash
wskill suggest "I need to debug a failing test"
# → Recommended: project:debugging
#   "Systematic debugging with root cause investigation..."
#
#   Use this skill? [Y/n]

wskill suggest "handle errors in TypeScript" --use
# Directly outputs the recommended skill content

wskill suggest "frontend components" -s project
# Limit suggestions to project skills
```

Interactive by default in TTY, auto-selects best match when piped:

```bash
wskill suggest "debugging" | pbcopy   # Best match content to clipboard
```

---

## Kits

A kit bundles multiple skills + reference docs into a single loadable unit.

### Use Cases

- **Frontend kit**: frontend-design skill + component patterns + style guide
- **Debugging kit**: debugging skill + TDD skill + project troubleshooting notes
- **New feature kit**: architecture skill + conventions + relevant docs
- **Onboarding kit**: project overview + coding standards + setup guides

### Kit Command

```bash
wskill kit frontend               # Load the frontend kit
wskill kit debugging --raw        # Raw output for piping
wskill kit list                   # List available kits
wskill kit show frontend          # Show kit contents without loading
```

### Kit Configuration

Defined in config (project or user level):

```json
{
  "kits": {
    "frontend": {
      "description": "Frontend development context",
      "skills": [
        "project:frontend-design",
        "project:component-patterns"
      ],
      "docs": [
        "./docs/style-guide.md",
        "./docs/components.md"
      ]
    },
    "debugging": {
      "description": "Debugging and troubleshooting",
      "skills": [
        "user:debugging",
        "user:tdd"
      ],
      "docs": [
        "./TROUBLESHOOTING.md"
      ]
    },
    "onboarding": {
      "description": "New team member context",
      "skills": [],
      "docs": [
        "./README.md",
        "./docs/architecture.md",
        "./docs/conventions.md"
      ]
    }
  }
}
```

### Kit Output

When loading a kit, outputs:
1. All skill content (formatted or raw)
2. All doc content (with file headers)

```bash
wskill kit frontend
# ## Kit: frontend
# Frontend development context
#
# ---
# ### Skill: project:frontend-design
# [skill content]
#
# ---
# ### Skill: project:component-patterns
# [skill content]
#
# ---
# ### Doc: ./docs/style-guide.md
# [doc content]
# ...
```

### Kit + Hook Integration

Kits could be auto-loaded via hook syntax:

```
w/kit:frontend
```

Or referenced in prompt:

```
Using the frontend kit, help me build a new component...
```

---

## Stats & Analytics

Track skill usage to understand what's valuable.

### Stats Command

```bash
wskill stats                      # Overall usage summary
wskill stats debug                # Stats for specific skill
wskill stats --top 10             # Most used skills
wskill stats --unused             # Skills never loaded
wskill stats --since 7d           # Last 7 days
wskill stats --json               # JSON output for tooling
```

### Basic Tracking (Phase 1)

Track when skills are loaded via CLI/hook:

```
Skill Usage Summary (last 30 days)
──────────────────────────────────
project:debugging      47 loads    last: 2h ago
user:tdd               31 loads    last: 1d ago
plugin:baselayer/debug 28 loads    last: 3h ago
project:frontend       12 loads    last: 5d ago
...

Unused skills: 3
  - project:old-patterns (never)
  - user:experimental (45d ago)
```

### Storage

Usage data stored in:
- `~/.claude/wskill/stats.json` (user-level)
- `.claude/wskill/stats.json` (project-level, gitignored)

```json
{
  "loads": [
    {
      "skillRef": "project:debugging",
      "timestamp": "2025-12-21T10:30:00Z",
      "source": "hook",
      "context": "prompt"
    }
  ],
  "summary": {
    "project:debugging": {
      "count": 47,
      "lastUsed": "2025-12-21T10:30:00Z"
    }
  }
}
```

### Advanced Tracking (Future)

Detect actual skill usage in Claude's output:

1. **Tool Call Hooks** - Monitor when Claude invokes skills via Skill tool
2. **Conversation Analysis** - Parse conversation history for skill references
3. **Project History** - Integrate with Claude's project history API (if available)

This would enable:
- "Skill was loaded but not followed" detection
- Effectiveness metrics (loaded → actually used)
- Skill recommendation improvements

### Privacy Considerations

- Stats are local-only by default
- No content is stored, only refs + timestamps
- Opt-in for any cloud sync (future)
- `wskill stats --clear` to reset

---

## Hook Integration

The `UserPromptSubmit` hook needs updates to align with new CLI:

### Current Hook Behavior

- Parses `w/<alias>` tokens from prompt
- Resolves and injects skill content

### Changes Needed

- Use new resolution logic
- Respect `--source` equivalent for disambiguation
- Output format should match `--raw` (injection-ready)
- Consider hook-specific config options

### Hook Config (Future)

```json
{
  "hook": {
    "autoInject": true,
    "defaultSource": ["project", "user"],
    "format": "raw"
  }
}
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WSKILL_SOURCE` | Default source filter |
| `WSKILL_OUTPUT` | Default output format |
| `WSKILL_CONFIG` | Override config path |
| `WSKILL_NO_COLOR` | Disable colored output |
| `PAGER` | Pager for pagination (default: less) |

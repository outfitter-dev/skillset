# Handoff: CLI Redesign Implementation

## Context

Full design documented in `.agents/notes/cli-redesign.md`. Issues tracked in beads.

## Implementation Order

Work through issues by priority, respecting dependencies:

### Phase 1: Core (Priority 1)

1. **WSKILL-9mv**: Core CLI restructure
   - `wskill` with no args = list all skills
   - `wskill <skill...>` = show skill(s)
   - Remove current `list` and `show` commands
   - **Subagent**: `senior-engineer`

2. **WSKILL-oog**: Add --source / -s variadic filter (depends on 9mv)
   - Variadic option: `-s project user`, `-s plugin:baselayer`
   - Filter list and disambiguate show
   - **Subagent**: `senior-engineer`

3. **WSKILL-0bc**: Output format flags (depends on 9mv)
   - `--text` (default TTY), `--raw` (pipe-friendly), `--json`
   - `-o` alias
   - **Subagent**: `senior-engineer`

4. **WSKILL-3gf**: Update hook integration (depends on 9mv)
   - Align with new resolution logic
   - Output format = raw
   - **Subagent**: `senior-engineer`

### Phase 2: Commands (Priority 2)

5. **WSKILL-fun**: config command
   - Interactive mode (no args)
   - `--edit` to open in $EDITOR
   - `get`/`set` subcommands with dot notation
   - `--scope` flag
   - **Subagent**: `senior-engineer`

6. **WSKILL-zsq**: alias command
   - `wskill alias <name> <skillRef>`
   - Prompt on overwrite
   - **Subagent**: `senior-engineer`

7. **WSKILL-33b**: unalias command
   - `wskill unalias <name>`
   - **Subagent**: `senior-engineer`

8. **WSKILL-4id**: init command
   - Scaffold config files
   - `--scope` flag
   - **Subagent**: `senior-engineer`

9. **WSKILL-6ld**: doctor command
   - Full diagnostics
   - `doctor config`, `doctor <skill>`
   - `--doctor` flag on other commands
   - **Subagent**: `senior-engineer`

10. **WSKILL-oqw**: kit command
    - `wskill kit <name>` to load bundle
    - `kit list`, `kit show <name>`
    - Config schema for kits
    - **Subagent**: `senior-engineer`

11. **WSKILL-0f3**: Piping behavior
    - Auto-switch to `--raw` when piped
    - One ref per line for list mode
    - **Subagent**: `senior-engineer`

12. **WSKILL-zxr**: Common flags
    - `--help`, `--version`, `--verbose`, `--quiet`
    - `--doctor` contextual flag
    - **Subagent**: `senior-engineer`

13. **WSKILL-q9n**: Remove deprecated commands (depends on 9mv)
    - Remove `inject`, `list`, `show`
    - **Subagent**: `senior-engineer`

### Phase 3: Polish (Priority 3)

14. **WSKILL-ems**: completions command
    - bash, zsh, fish, powershell
    - **Subagent**: `senior-engineer`

15. **WSKILL-xi7**: stats v1
    - Basic tracking via CLI/hook
    - `--top`, `--unused`, `--since`, `--json`, `--clear`
    - **Subagent**: `senior-engineer`

16. **WSKILL-csv**: stats v2 (depends on xi7)
    - Hook/Claude integration
    - Effectiveness metrics
    - **Subagent**: `senior-engineer`

17. **WSKILL-2zv**: Pagination
    - Page long output in TTY
    - Respect $PAGER
    - **Subagent**: `senior-engineer`

18. **WSKILL-l3k**: Environment variables
    - WSKILL_SOURCE, WSKILL_OUTPUT, WSKILL_CONFIG, WSKILL_NO_COLOR
    - **Subagent**: `senior-engineer`

## Workflow Per Issue

1. Mark beads issue as in_progress
2. Read design notes for that feature
3. Invoke `senior-engineer` subagent for implementation
4. Run tests (`bun test`)
5. Run build (`bun run build`)
6. Invoke `code-reviewer` if significant changes
7. Commit with `safe-commit-specialist`
8. Mark beads issue as closed

## Key Files

- `src/cli.ts` - Main CLI entry point
- `src/config/index.ts` - Config loading
- `src/types.ts` - Type definitions
- `src/format/index.ts` - Output formatting
- `src/hook.ts` - Hook integration
- `src/tree/index.ts` - Tree building

## Reserved Commands

config, alias, unalias, index, init, doctor, completions, kit, stats, browse (future), search (future), suggest (future)

## Start Here

Begin with **WSKILL-9mv** (Core CLI restructure). This is the foundation that other features depend on.

# Phase 6: Documentation Update

## Scope

Update all documentation to reflect the new naming and syntax.

## Dependencies

- **Phases 0-5, 8** must complete first (includes CLI Redesign)

## Files to Modify

### README.md

| Section | Changes |
| ------- | ------- |
| Title | `# wskill` → `# skillset` |
| Description | `w/<alias>` → `$<alias>` (prompt tokens); `$set:<ref>` forces set resolution |
| Commands | All `wskill` → `skillset` |
| Paths | `.claude/wskill/` → `.skillset/` |
| Structure | Update to reflect monorepo structure (`packages/core`, `apps/cli`) |
| Structure | `plugins/wskill` → `plugins/skillset` |
| Notes | `$<ref>` tokens are for prompt text; CLI args use plain refs |

### CLAUDE.md

| Section | Changes |
| ------- | ------- |
| Overview | `wskill provides...` → `skillset provides...` |
| Overview | `w/<alias>` → `$<alias>` |
| Commands | Update all paths to use monorepo structure |
| Architecture | Tokenizer extracts `$<ref>` (kebab-case only) |
| Architecture | Cache path `.skillset/cache.json` |
| Architecture | Update to reflect `packages/core` and `apps/cli` structure |
| Plugin Integration | `plugins/skillset/` |
| Key Types | `InvocationToken` - Parsed `$<ref>` token |
| Testing | Update test commands to reflect monorepo |
| Publishing | Update publishing workflow to reflect monorepo packages |

### AGENTS.md

| Section | Changes |
| ------- | ------- |
| Structure | Update paths |
| Commands | All `wskill` → `skillset` |
| Git | Example message update |
| Config | `.skillset/config.json` |

## Content Patterns to Replace

### Global Search/Replace

| Pattern | Replacement |
| ------- | ----------- |
| `wskill` | `skillset` |
| `w/<alias>` | `$<alias>` |
| `w/` (in context of skills) | `$` |
| `.claude/wskill/` | `.skillset/` |
| `~/.claude/wskill/` | `~/.skillset/` |
| `plugins/wskill/` | `plugins/skillset/` |
| `src/` paths | Update to `apps/cli/src/` or `packages/core/src/` as appropriate |

### Specific Examples to Update

```text
# Old
Use `w/<alias>` in prompts to inject explicit Skills

# New
Use `$<alias>` in prompts to inject explicit Skills
```

```text
# Old
bun run src/index.ts resolve w/foo

# New
bun run apps/cli/src/index.ts resolve foo
```

### CLI Command Documentation

Update command examples to reflect new verb-first structure:

```bash
# Old
wskill                        # List all skills
wskill <skill>                # Show skill
wskill kit <name>             # Load kit

# New
skillset list                 # List all skills/sets
skillset show <ref>           # Show skill or set metadata
skillset load <ref>           # Load skill or set content
skillset alias [name] [ref]   # Manage aliases (interactive if args omitted)
skillset unalias [name]       # Remove alias (interactive if arg omitted)
skillset sync                 # Sync to tool directories
skillset index                # Reindex skills
skillset doctor               # Diagnostics
skillset config               # Config management
skillset init                 # Initialize
```

Document global flags:
- `--json` - Structured JSON output
- `--raw` - Minimal/unformatted output
- `--quiet` / `-q` - Suppress non-essential output
- `--verbose` / `-v` - Extra detail
- `-s / --source` - Source filter (project/user/plugin)
- `--kind` - Disambiguate skill vs set when names collide

## Checklist

- [ ] Update `README.md`
- [ ] Update `CLAUDE.md`
- [ ] Update `AGENTS.md`
- [ ] Document new CLI command structure
- [ ] Document interactive modes for alias/unalias
- [ ] Document collision handling (`--kind`, interactive selection)
- [ ] Document global flags
- [ ] Verify no broken references
- [ ] Verify examples are accurate

## Validation

```bash
# No wskill references in docs (excluding historical notes)
grep -l "wskill" *.md | grep -v ".agents"

# No w/ pattern references (in skill context)
grep "w/" *.md | grep -v "w/o" | grep -v ".agents"

# Verify paths referenced exist
# README should reference existing directories
```

## Do NOT Modify

The following files are historical records and should NOT be changed:

- `.agents/notes/202512220959-skillset-rename.md`
- `.agents/notes/cli-redesign.md`
- `.agents/notes/202512200826-cli-improvements.md`
- `.agents/notes/handoff-cli-redesign.md`

These document the evolution of the project and renaming decisions.

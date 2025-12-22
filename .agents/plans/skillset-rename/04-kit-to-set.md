# Phase 4: Kit → Set Rename

## Scope

Rename the "kit" concept to "set". Sets share the same `$<ref>` invocation syntax as skills, with an optional explicit `$set:<ref>` prefix.

## Dependencies

- **Phase 0** must complete first (monorepo conversion establishes file structure)
- **Phase 2** must complete first (invocation syntax `$<ref>`)

## Concept Changes

| Old | New | Description |
| --- | --- | ----------- |
| `kit` | `set` | Bundled collection of skills |
| `w/kit:name` | `$<ref>` or `$set:<ref>` | Same token as skills; `set:` forces set resolution |
| `kits` config key | `sets` | Config schema |
| `kit` command | `set` command | CLI subcommand (legacy; Phase 8 may supersede) |

## Resolution & Collision Rules

Because `$<ref>` can refer to a skill **or** a set (unless prefixed with `set:`):

1. **Alias mapping first** (if an alias points to a specific skill/set, use it).
2. If only one of skill or set exists, resolve to that.
3. If both exist (and no `set:` or `skill:` prefix was used):
   - **TTY CLI**: prompt to choose (skill vs set), with a "remember choice" option to create an alias.
   - **Non-TTY / hooks**: return an ambiguity error with guidance to create an alias or pass `--kind` in CLI commands.

## Files to Modify

### CLI Commands

| File | Change |
| ---- | ------ |
| `apps/cli/src/cli.ts:207` | `.command("kit")` → `.command("set")` |
| `apps/cli/src/cli.ts:208` | `"Manage skill kits"` → `"Manage skill sets"` |
| `apps/cli/src/cli.ts:209` | `notImplemented("kit")` → `notImplemented("set")` |

### Tokenizer

No `$$` syntax. Tokenizer parses `$<ref>` and `$set:<ref>` (Phase 2). Set resolution happens in the resolver.

### Types

If `types.ts` has kit-related types, rename them:
- `Kit` → `SkillSet` (or just `Set` if no collision)
- `KitConfig` → `SetConfig`

### Config Schema

If config has `kits` key:

```json
{
  "kits": { ... }
}
```

Change to:

```json
{
  "sets": { ... }
}
```

## Checklist

- [ ] Rename `kit` command to `set` in `apps/cli/src/cli.ts`
- [ ] Remove any `$$` tokenizer logic
- [ ] Update any type definitions for kits → sets
- [ ] Update config schema if applicable
- [ ] Implement collision handling in resolver/CLI (Phase 8 ties in)

## Validation

```bash
# Set command should exist (legacy)
bun run apps/cli/src/index.ts set --help

# $ tokens should resolve skills or sets
# (use a prompt file to avoid shell expansion)
cat <<'PROMPT' | bun run apps/cli/src/index.ts inject -
load $frontend
PROMPT

# Explicit set token should resolve to set
cat <<'PROMPT' | bun run apps/cli/src/index.ts inject -
load $set:frontend
PROMPT

# No references to "kit" (excluding comments about what was renamed)
grep -r "\bkit\b" apps/ packages/ --include="*.ts" | grep -v "toolkit" | grep -v "// "
```

## Design Decision

Sets are invoked like skills with `$<ref>`; `$set:<ref>` forces set resolution, `$skill:<ref>` forces skill resolution. Disambiguation is handled via aliases, interactive prompts, or explicit CLI flags (`--kind`).

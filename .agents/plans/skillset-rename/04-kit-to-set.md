# Phase 4: Kit → Set Rename

## Scope

Rename the "kit" concept to "set" with new `$$` invocation syntax.

## Dependencies

- **Phase 0** must complete first (monorepo conversion establishes file structure)
- **Phase 2** must complete first (invocation syntax `$` pattern)

## Concept Changes

| Old | New | Description |
| --- | --- | ----------- |
| `kit` | `set` | Bundled collection of skills |
| `w/kit:name` | `$$name` | Invocation syntax |
| `kits` config key | `sets` | Config schema |
| `kit` command | `set` command | CLI subcommand |

## Files to Modify

### CLI Commands

| File | Change |
| ---- | ------ |
| `apps/cli/src/cli.ts:207` | `.command("kit")` → `.command("set")` |
| `apps/cli/src/cli.ts:208` | `"Manage skill kits"` → `"Manage skill sets"` |
| `apps/cli/src/cli.ts:209` | `notImplemented("kit")` → `notImplemented("set")` |

### Tokenizer (add set pattern)

The tokenizer needs to recognize `$$name` as a set invocation:

```typescript
// Pattern for skill sets: $$<name>
/\$\$([a-zA-Z0-9_-]+)/g
```

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
- [ ] Add `$$` pattern recognition to tokenizer in `packages/core/src/tokenizer/`
- [ ] Update any type definitions for kits → sets in `packages/core/src/types.ts`
- [ ] Update config schema if applicable in `packages/core/src/config/`
- [ ] Update any references in other source files

## Validation

```bash
# Set command should exist
bun run apps/cli/src/index.ts set --help

# $$ pattern should be recognized
echo 'load $$frontend' | bun run apps/cli/src/index.ts inject -

# No references to "kit" (excluding comments about what was renamed)
grep -r "\bkit\b" apps/ packages/ --include="*.ts" | grep -v "toolkit" | grep -v "// "
```

## Design Decision

The `$$` syntax was chosen because:
1. Builds on the `$skill` pattern (double = set/collection)
2. Visually distinct from single skills
3. Not commonly used in normal prose
4. Easy to type

Alternative considered: `$@name` or `$*name` - rejected for complexity.

# Phase 2: Invocation Syntax (w/ → $)

## Scope

Replace the `w/<alias>` invocation pattern with `$<alias>` throughout the codebase.

## Dependencies

**Phase 0** must complete first (monorepo conversion establishes file structure).

## Pattern Changes

| Old | New | Example |
| --- | --- | ------- |
| `w/<alias>` | `$<alias>` | `$debug` |
| `w/<ns>:<alias>` | `$<ns>:<alias>` | `$project:debug` |
| `w/...` (literal) | `$...` | Documentation text |

## Files to Modify

### Core Tokenizer

| File | Line | Change |
| ---- | ---- | ------ |
| `packages/core/src/tokenizer/index.ts` | regex | `w/` → `$` in token pattern |

### Resolver

| File | Change |
| ---- | ------ |
| `apps/cli/src/doctor.ts:13` | `raw.startsWith("w/")` → `raw.startsWith("$")` |
| `apps/cli/src/doctor.ts:17` | `raw: \`w/${cleaned}\`` → `raw: \`$${cleaned}\`` |
| `apps/cli/src/cli.ts:822` | `raw.startsWith("w/")` → `raw.startsWith("$")` |
| `apps/cli/src/cli.ts:826` | `raw: \`w/${cleaned}\`` → `raw: \`$${cleaned}\`` |

### Format Output

| File | Change |
| ---- | ------ |
| `packages/core/src/format/index.ts:10` | `"via \`w/alias\`"` → `"via \`$alias\`"` |
| `packages/core/src/format/index.ts:10` | `"Ignore the literal \`w/...\`"` → `"Ignore the literal \`$...\`"` |

### Hook Runner

| File | Change |
| ---- | ------ |
| `packages/core/src/hooks/hook-runner.ts:25` | Comment `// Extract w/<alias>` → `// Extract $<alias>` |

## Regex Update

The tokenizer needs a new regex pattern. Current likely pattern:

```typescript
/\bw\/([a-zA-Z0-9_:-]+)/g
```

New pattern:

```typescript
/\$([a-zA-Z0-9_:-]+)/g
```

**Note**: The `$` character needs no escape in regex (it's only special at end of pattern).

## Checklist

- [ ] Update tokenizer regex in `packages/core/src/tokenizer/index.ts`
- [ ] Update `startsWith("w/")` checks in `apps/cli/src/doctor.ts`
- [ ] Update `startsWith("w/")` checks in `apps/cli/src/cli.ts`
- [ ] Update template literals `w/${...}` in `apps/cli/src/doctor.ts`
- [ ] Update template literals `w/${...}` in `apps/cli/src/cli.ts`
- [ ] Update format strings in `packages/core/src/format/index.ts`
- [ ] Update comment in `packages/core/src/hooks/hook-runner.ts`

## Validation

```bash
# Tokenizer should extract $ tokens
echo 'test $debug and $project:auth' | bun run apps/cli/src/index.ts inject -

# Search should return 0 results for w/ pattern (excluding tests/notes)
grep -r "w/" apps/ packages/ --include="*.ts" | grep -v ".test.ts" | grep -v "// " | grep -v "w/o"
```

## Edge Cases

- Shell variable syntax: `$VAR` vs `$skill` - distinguishable by:
  - Skills require lowercase letters after `$`
  - Shell vars typically UPPERCASE
  - Context: within prompts vs shell scripts

- Consider: Should we require `$` to be word-boundary? (e.g., not match `$$skill`)
  - Decision: Yes, but `$$` is reserved for sets (Phase 4)

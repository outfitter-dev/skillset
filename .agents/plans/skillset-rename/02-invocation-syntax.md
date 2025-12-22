# Phase 2: Invocation Syntax (w/ → `$<ref>`)

## Scope

Replace the `w/<alias>` invocation pattern with `$<ref>` tokens in prompt text.

**No backward compatibility:** remove all `w/` parsing immediately in this phase. There is no legacy support or fallback.

**Important:** `$` tokens are for prompt text only. CLI commands should accept plain refs (no `$`) to avoid shell expansion.

## Dependencies

**Phase 0** must complete first (monorepo conversion establishes file structure).

## Pattern Changes

| Old | New | Example |
| --- | --- | ------- |
| `w/<alias>` | `$<alias>` | `$debug` |
| `w/<ns>:<alias>` | `$<ns>:<alias>` | `$project:debug` |
| `w/kit:<name>` | `$<name>` or `$set:<name>` | `$frontend` / `$set:frontend` |
| `w/...` (literal) | `$...` (literal) | Documentation text |

**Note:** `$<ref>` is interchangeable for skills and sets. If a name collides, use `$set:<ref>` to force a set or follow the resolution rules (Phase 4 / Phase 8).

## Token Rules (tightened)

- Prefix must be **exactly** `$`.
- Optional explicit kind prefixes: `$set:<ref>` forces set resolution, `$skill:<ref>` forces skill resolution.
- `<ref>` is one or more colon-separated **kebab-case** segments.
  - Segment regex: `[a-z0-9]+(?:-[a-z0-9]+)*`
  - Full ref: `segment(:segment)*`
- **Invalid**: uppercase, underscores, camelCase, spaces, or empty segments.
- Double-dollar prefixes are **not** supported.
- The `set:` and `skill:` prefixes are reserved (cannot be used as namespace names).

Valid examples:
- `$debug`
- `$project:frontend-design`
- `$frontend`
- `$set:frontend`
- `$set:project:frontend`
- `$skill:frontend`

Invalid examples (must NOT match):
- `$ALLCAPS`
- `$Debug`
- `$my_skill`
- `$set:` (missing ref)
- `$skill:` (missing ref)
- `$project:`

## Files to Modify

### Core Tokenizer

| File | Change |
| ---- | ------ |
| `packages/core/src/tokenizer/index.ts` | Update token regex + parsing for `$<ref>` with kebab-case-only refs |

### Resolver / CLI

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
| `packages/core/src/hooks/hook-runner.ts:25` | Comment `// Extract w/<alias>` → `// Extract $<ref> (kebab-case, optional namespace)` |

## Regex Update

Tokenizer should only match lowercase kebab-case refs, with optional `set:` or `skill:` prefixes.

```typescript
// Capture: optional kind ("skill" | "set"), ref (kebab-case segments with optional namespaces)
/\$(?:(skill|set):)?([a-z0-9]+(?:-[a-z0-9]+)*(?::[a-z0-9]+(?:-[a-z0-9]+)*)*)/g
```

**Note:** In JS regex literals, `$` must be escaped to match a literal dollar sign.

## Checklist

- [ ] Update tokenizer regex + parsing for `$<ref>`
- [ ] Update `startsWith("w/")` checks in `apps/cli/src/doctor.ts`
- [ ] Update `startsWith("w/")` checks in `apps/cli/src/cli.ts`
- [ ] Update template literals `w/${...}` in `apps/cli/src/doctor.ts` and `apps/cli/src/cli.ts`
- [ ] Update format strings in `packages/core/src/format/index.ts`
- [ ] Update comment in `packages/core/src/hooks/hook-runner.ts`

## Validation

```bash
# Tokenizer should extract $ tokens (prompt text via here-doc)
cat <<'PROMPT' | bun run apps/cli/src/index.ts inject -
test $debug and $project:auth and $frontend
PROMPT

# Explicit set token should match
cat <<'PROMPT' | bun run apps/cli/src/index.ts inject -
load $set:frontend
PROMPT

# Explicit skill token should match
cat <<'PROMPT' | bun run apps/cli/src/index.ts inject -
load $skill:frontend
PROMPT

# Tokenizer should NOT match w/ tokens
cat <<'PROMPT' | bun run apps/cli/src/index.ts inject -
test w/debug
PROMPT

# Search should return 0 results for w/ pattern (excluding tests/notes)
grep -r "w/" apps/ packages/ --include="*.ts" | grep -v ".test.ts" | grep -v "// " | grep -v "w/o"
```

## Edge Cases

- `$ALLCAPS` must never match.
- `$snake_case` must never match.
- Double-dollar prefixes must never match.
- `$set:` without a ref must never match.
- `$skill:` without a ref must never match.
- `$` tokens are for prompt text; CLI args should not require `$`.

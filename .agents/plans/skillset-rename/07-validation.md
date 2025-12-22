# Phase 7: Validation

## Scope

Update tests, run full validation suite, and verify the refactor is complete.

## Dependencies

- **All previous phases (0-6, 8)** must complete first

## Test Updates

### Tokenizer Tests

**File**: `packages/core/src/tokenizer/tokenizer.test.ts`

- Replace all `w/` fixtures with `$` equivalents.
- Add negative cases to ensure **no** matches for uppercase or snake_case.
- Add negative cases to ensure `w/` is never matched.

Suggested new cases:
- `$frontend-design` → matches
- `$project:frontend-design` → matches
- `$set:frontend-design` → matches (explicit set)
- `$skill:frontend-design` → matches (explicit skill)
- `$ALLCAPS` → no match
- `$snake_case` → no match
- `$bad--token` → no match

### Resolver Tests

**File**: `packages/core/src/resolver/resolver.test.ts`

- Replace all `w/` raw values with `$<ref>` (no `$skill:` prefix).
- Add ambiguity tests if both skill and set share the same name.

## Validation Checklist

### Build Validation

- [ ] `bun run build` succeeds
- [ ] No TypeScript errors
- [ ] Output in `dist/` is generated

### Test Validation

- [ ] All tokenizer tests pass with new `$` syntax
- [ ] All resolver tests pass with new `$` syntax
- [ ] `bun test` exits 0

### CLI Validation

- [ ] `bun run apps/cli/src/index.ts --help` shows `skillset`
- [ ] `bun run apps/cli/src/index.ts doctor` runs without error
- [ ] `bun run apps/cli/src/index.ts index` scans skills successfully

### CLI Redesign Validation (Phase 8)

**Verb-first commands exist:**

- [ ] `skillset list --help` shows usage
- [ ] `skillset show --help` shows usage
- [ ] `skillset load --help` shows usage
- [ ] `skillset sync --help` shows usage
- [ ] `skillset alias --help` shows usage
- [ ] `skillset unalias --help` shows usage
- [ ] `skillset config --help` shows usage

**Global flags work:**

- [ ] `skillset list --json` outputs valid JSON
- [ ] `skillset list --raw` outputs minimal format
- [ ] `skillset list --quiet` suppresses non-essential output
- [ ] `skillset list --verbose` shows extra detail

**Interactive modes (TTY):**

```bash
# These should show interactive picker in TTY
skillset alias test-alias      # Should show skill/set picker
skillset unalias               # Should show alias picker
```

**Non-TTY graceful degradation:**

```bash
# Should error with usage hint, not hang
echo "" | skillset alias test-alias
echo "" | skillset unalias
```

**Ambiguity handling:**

```bash
# If both a skill and set named "design" exist, TTY should prompt
skillset show design

# Non-TTY should error with guidance
printf '%s' "" | skillset show design

# Explicit disambiguation
skillset show design --kind skill
skillset show design --kind set
```

**Command functionality:**

```bash
# List should work
skillset list
skillset list --sets
skillset list --skills

# Show should display metadata
skillset show <existing-skill>
skillset show <existing-set> --kind set

# Load should output content
skillset load <existing-skill>
skillset load <existing-set> --kind set
```

### Integration Validation

```bash
# Create test skill
mkdir -p .claude/skills/test-skill
echo "# Test Skill\nThis is a test." > .claude/skills/test-skill/SKILL.md

# Index it
bun run apps/cli/src/index.ts index

# Resolve with new syntax (prompt text)
cat <<'PROMPT' | bun run apps/cli/src/index.ts inject -
Hello $test-skill world
PROMPT

# Clean up
rm -rf .claude/skills/test-skill
```

### Search Validation

```bash
# No remaining wskill references in source (excluding historical)
echo "=== Checking apps/ and packages/ ==="
grep -r "wskill" apps/ packages/ --include="*.ts" && echo "FAIL: wskill found" || echo "OK"

echo "=== Checking plugins/ ==="
grep -r "wskill" plugins/ && echo "FAIL: wskill in plugins" || echo "OK"

echo "=== Checking docs ==="
grep "wskill" README.md CLAUDE.md AGENTS.md && echo "FAIL: wskill in docs" || echo "OK"

echo "=== Checking for w/ patterns ==="
grep -r "w/" apps/ packages/ --include="*.ts" | grep -v "\.test\.ts" | grep -v "//" && echo "FAIL: w/ found" || echo "OK"

```

## Final Checklist

- [ ] All tests pass
- [ ] Build succeeds
- [ ] CLI works with new name
- [ ] No stray `wskill` references (except historical)
- [ ] No stray `w/` patterns (except historical)
- [ ] Directory structure is correct
- [ ] Plugin is updated
- [ ] CLI redesign complete (verb-first commands)
- [ ] Interactive modes work in TTY
- [ ] Global flags work across all commands

## Post-Validation

After validation passes:

1. **Commit the changes**:

   ```bash
   git add -A
   git commit -m "refactor: rename wskill to skillset with $ invocation syntax"
   ```

2. **Create GitHub repo** (if not exists):

   ```bash
   gh repo create outfitter-dev/skillset --public --source=. --push
   ```

3. **Publish to npm**:

   ```bash
   bun run build
   npm version patch  # or minor
   npm publish --access public
   ```

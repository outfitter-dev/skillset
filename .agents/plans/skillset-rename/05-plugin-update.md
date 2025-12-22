# Phase 5: Plugin Update

## Scope

Rename and update the `plugins/wskill/` directory to `plugins/skillset/`.

## Dependencies

- **Phases 0-4** must complete first

## Directory Rename

```bash
mv plugins/wskill plugins/skillset
```

## Files to Modify

### Plugin Manifest

**File**: `plugins/skillset/.claude-plugin/plugin.json`

```json
{
  "name": "skillset",           // was: "wskill"
  ...
  "repository": "https://github.com/outfitter-dev/skillset"  // was: galligan/wskill
}
```

### Hooks Configuration

**File**: `plugins/skillset/hooks/hooks.json`

| Change | Old | New |
| ------ | --- | --- |
| Description | `"wskill: Deterministic..."` | `"skillset: Deterministic..."` |
| Syntax | `"via w/alias syntax"` | `"via $alias syntax"` |
| Script path | `wskill-hook.ts` | `skillset-hook.ts` |

### Hook Script

**Rename**: `scripts/wskill-hook.ts` → `scripts/skillset-hook.ts`

**File**: `plugins/skillset/scripts/skillset-hook.ts`

| Line | Change |
| ---- | ------ |
| Comment | `"Plugin hook entrypoint for wskill"` → `"Plugin hook entrypoint for skillset"` |
| Import | `import("wskill/hook")` → `import("skillset/hook")` |
| Fallback path | Update any paths to use monorepo structure if needed |

### Commands

**File**: `plugins/skillset/commands/doctor.md`
- Update any `wskill` references

**File**: `plugins/skillset/commands/init.md`
- Line 2: `"Initialize wskill config..."` → `"Initialize skillset config..."`
- Line 5: All `wskill` → `skillset`, `w/<alias>` → `$<alias>`

**File**: `plugins/skillset/commands/index.md`
- Line 5: `wskill index` → `skillset index`

**File**: `plugins/skillset/commands/manage.md`
- Line 5: `.claude/wskill/config.json` → `.claude/skillset/config.json`
- Line 5: `w/<alias>` → `$<alias>`

**File**: `plugins/skillset/commands/with-skill.md`
- Line 2: `"Interactive entry to wskill helpers"` → `"Interactive entry to skillset helpers"`
- Line 5: All `w/<alias>` → `$<alias>`, `/wskill:` → `/skillset:`

### Bundled Skill

**Rename**: `skills/wskill/SKILL.md` → `skills/skillset/SKILL.md`

**File**: `plugins/skillset/skills/skillset/SKILL.md`

| Line | Change |
| ---- | ------ |
| Title | `# wskill` → `# skillset` |
| All | `w/<alias>` → `$<alias>` |
| All | `w/...` → `$...` |
| Commands | `/wskill:index` → `/skillset:index` |
| Commands | `/wskill:manage` → `/skillset:manage` |
| Commands | `/wskill:doctor` → `/skillset:doctor` |

## Checklist

- [ ] Rename `plugins/wskill/` → `plugins/skillset/`
- [ ] Update `plugin.json` (name, repository)
- [ ] Update `hooks.json` (description, script path)
- [ ] Rename `wskill-hook.ts` → `skillset-hook.ts`
- [ ] Update hook script imports
- [ ] Update all command `.md` files
- [ ] Rename and update bundled SKILL.md

## Validation

```bash
# Directory should exist
ls -la plugins/skillset/

# No references to wskill in plugin
grep -r "wskill" plugins/skillset/

# Plugin manifest valid
cat plugins/skillset/.claude-plugin/plugin.json | jq .

# Hook script syntax check
bun run plugins/skillset/scripts/skillset-hook.ts --help 2>&1 || true
```

## Notes

The plugin scaffold is designed to be installed to `~/.claude/plugins/skillset/`. After this rename, users would:

```bash
# Install plugin (hypothetically)
cp -r plugins/skillset ~/.claude/plugins/
```

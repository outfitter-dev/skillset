# Phase 1: Core Naming (wskill → skillset)

## Scope

Replace all occurrences of `wskill` with `skillset` in source code, except:
- Historical agent notes (`.agents/notes/`)
- `.wskill-legacy/` backup directory

## Dependencies

**Phase 0** must complete first (monorepo conversion establishes file structure).

## Files to Modify

### Source Files

| File | Changes |
| ---- | ------- |
| `apps/cli/src/cli.ts:39` | `.name("wskill")` → `.name("skillset")` |
| `apps/cli/src/cli.ts:120` | Description text |
| `apps/cli/src/cli.ts:233` | Doctor description |
| `apps/cli/src/cli.ts:319` | Error message |
| `apps/cli/src/cli.ts:940` | Init comment |
| `packages/core/src/format/index.ts:10` | `"## wskill: Resolved Skills"` → `"## skillset: Resolved Skills"` |
| `packages/core/src/format/index.ts:80` | `"## wskill: Warnings"` → `"## skillset: Warnings"` |
| `apps/cli/src/doctor.ts:24` | `"wskill doctor"` → `"skillset doctor"` |
| `apps/cli/src/doctor.ts:118-122` | Plugin detection path and messages |
| `apps/cli/src/doctor.ts:133` | Doctor config heading |
| `apps/cli/src/doctor.ts:207` | Doctor skill heading |
| `apps/cli/src/doctor.ts:254-255` | Suggestion messages |
| `packages/core/src/logger/index.ts:9` | Logger namespace `"wskill"` → `"skillset"` |
| `packages/core/src/config/index.ts:16-18` | Path constants |
| `packages/core/src/config/index.ts:27` | Warning message prefix |
| `packages/core/src/cache/index.ts:19-20` | Path constants |
| `packages/core/src/cache/index.ts:30` | Warning message prefix |

### Config Files

| File | Changes |
| ---- | ------- |
| `package.json` | `bin.wskill` → `bin.skillset`, already `name: "skillset"` |

## Checklist

- [ ] Replace `wskill` in `apps/cli/src/cli.ts` (5 occurrences)
- [ ] Replace `wskill` in `packages/core/src/format/index.ts` (2 occurrences)
- [ ] Replace `wskill` in `apps/cli/src/doctor.ts` (8 occurrences)
- [ ] Replace `wskill` in `packages/core/src/logger/index.ts` (2 occurrences)
- [ ] Replace `wskill` in `packages/core/src/config/index.ts` (4 occurrences)
- [ ] Replace `wskill` in `packages/core/src/cache/index.ts` (3 occurrences)
- [ ] Update `apps/cli/package.json` bin entry

## Validation

```bash
# Search should return 0 results in apps/ and packages/
grep -r "wskill" apps/ packages/ --include="*.ts" | grep -v ".test.ts"

# CLI name should be skillset
bun run apps/cli/src/index.ts --help | head -1  # Should show "skillset"
```

## Notes

- Tests will be updated in Phase 7 (Validation) to use new patterns
- Do NOT modify `.agents/notes/` files - they are historical records
- Logger paths will be updated when directory structure changes (Phase 3)

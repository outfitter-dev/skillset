---
description: Documents exact-revision search patterns, finite tracked scope, counts, and explicit exclusions.
---

# SET-433 operational search scope

Code baseline `5b53799f470916d97eac13a4b7ecb8ab96762648`; historical inspections and fixture baselines are named where they differ. Test names cite evidence and are not claims that this documentation pass ran them. See the [overview](./2026-10-30-set-433-transform-inventory.md) for disposition categories and acceptance status.

## Reproduction and counts

Production candidates are tracked TypeScript under `apps/`, `packages/`, `scripts/`, excluding paths containing `__tests__` or `fixtures` and files ending `.test.ts` / `.spec.ts`. `git ls-tree -r --name-only 2e620e50405c175097350861063b454738a5d339 -- apps packages scripts | rg '\.ts$' | rg -v '(^|/)(__tests__|fixtures)/|\.(test|spec)\.ts$' | wc -l` yields 500 files. This broad candidate universe includes test-helper scripts; some TS/JS entrypoints and generated scripts outside these roots are separately called out below. Search uses git's tracked tree, not the current worktree.

Run these commands in the repository against the named immutable revision; quote the literal pathspecs as shown:

```bash
revision=2e620e50405c175097350861063b454738a5d339
paths=('apps/**/*.ts' 'packages/**/*.ts' 'scripts/*.ts' 'scripts/**/*.ts' ':!**/__tests__/**' ':!**/*.test.ts' ':!**/*.spec.ts' ':!**/fixtures/**')
git grep -n -I -E '\.(replace|replaceAll)\s*\(' "$revision" -- "${paths[@]}"
git grep -n -I -E '(\.claude/|\.codex/|\.cursor/|CLAUDE\.md|AGENTS\.md|CLAUDE_PLUGIN_ROOT|CODEX_PLUGIN_ROOT|CURSOR_PLUGIN_ROOT)' "$revision" -- "${paths[@]}"
git grep -n -I -E '(dialect|translateClaudeDialect|lowerTransform|recognizeTransforms)' "$revision" -- "${paths[@]}"
git grep -n -I -E '(target|provider)[[:space:]]*(===|!==)|switch[[:space:]]*\([[:space:]]*(target|provider)|\["(claude|codex|cursor)"' "$revision" -- "${paths[@]}"
git grep -n -I -E '(migrat(e|ion|or)|legacy|compatib(ility|le))' "$revision" -- "${paths[@]}"
git grep -n -I -E '(registerTransformEntry|transformEntries|listTransformEntries|lowerTransform|recognizeTransforms|renderer|renderOwner)' "$revision" -- "${paths[@]}"
git grep -n -I -E '(allowlist|allowList|allow\(|ALLOWLIST|target-topology|guard)' "$revision" -- "${paths[@]}"
git grep -n -I -E '(claude|codex|cursor|preprocess|preload|MCP|allowed.tools|ARGUMENTS|manifest|native|scope|target)' "$revision" -- '.skillset/RULES.md' '.skillset/skills/**' '.skillset/plugins/**' '.agents/**' '.claude/**' '.cursor/**' 'plugins/skillset/**' 'docs/reference/providers/**' AGENTS.md
```

| Search group | Matching lines | Distinct tracked files | Limits |
|---|---:|---:|---|
| `.replace` / `.replaceAll` calls | 416 | 157 | Only dot calls with `(` on same line; computed property calls, aliases, `split`/`join`, parsers, AST transforms, regex construction, other languages and second-line callee syntax can escape. |
| named provider paths/documents/runtime variables | 153 | 42 | Literal vocabulary only; generated path factories, dynamic template strings, alternate spellings and path joins need separate tracing. |
| dialect and transform recognition | 161 | 30 | Includes schema, tests' production fixtures/examples, report text and unrelated public-closure shell dialects. |
| target/provider comparisons, switches and a double-quoted set prefix | 395 | 104 | Single quotes, different variable names, registry values, `includes`/Set/map dispatch and dynamic calls can escape. Topology AST guard covers additional explicit patterns, not arbitrary dispatch. |
| migration/legacy/compatibility | 677 | 116 | Broad lexical group includes docs, schema, source/report state and commentary; absence of word does not rule out a migration. |
| transform and renderer registry terms | 189 | 36 | `renderer` catches CLI display renderers and conformance scripts; it is not a complete dynamic call graph. |
| guard/allowlist terms | 145 | 35 | Includes generated lock and unrelated safety guards; AST guards and exceptions require direct file inspection. |
| source/generated/provider guidance | 1,182 | 112 | Broad search includes generated lock JSON, archived plans, contributor skill scripts and RETRO; these are not all active mapping claims. Separate root `AGENTS.md` search adds 18 lines, already-included `.claude/CLAUDE.md` adds 18 duplicate lines. |

Line counts are not counts of mappings. Groups overlap; tests and independent external source are evidence, not implied by grep. Raw search output records revision, file, line and matching text. Search commands use GNU-compatible ERE in `git grep`, not a test that all syntax is covered.


## Reconciliation and boundaries

The 500 tracked TypeScript production candidates are a finite operational search universe, not a count of semantic mappings. The additional [guard and executable-payload audit](./2026-10-30-set-433-guards-and-guidance.md) searches split/join/slice, URL/encoding, regex and interpolation, and the three tracked non-TS shell entrypoints. Setup and identity, runtime readiness, state and island rows have dedicated linked pages. Test helpers, generated locks, historical plans and guard-only recognizers are categorized rather than counted as provider transforms. Third-party dependency internals and external consumers are outside repository-owned inventory; this exclusion does not assert their behavior. Search detects only the specified patterns, and does not establish dynamic semantic equivalence.

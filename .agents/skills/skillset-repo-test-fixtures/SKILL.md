---
description: Work on Skillset's own compiler test fixtures, fixture docs, fixture-backed tests, or fixture layout decisions in this repo.
metadata:
  generated: skillset@0.1.0
  version: 0.1.2
name: skillset-repo-test-fixtures
---

# Skillset Repo Test Fixtures

Use this skill when changing Skillset's internal compiler fixtures, fixture documentation, or tests whose setup builds fake Skillset repos.

## Fixture Boundary

- Fixtures are internal compiler test material, not product source-root `tests.yaml` declarations.
- Prefer inline temp fixtures in `apps/skillset/src/__tests__/` for focused positive cases, negative diagnostics, and lifecycle edge cases.
- Add checked-in `fixtures/<case>/` repos only when a case needs whole-repo inspection, is shared as a golden reference, or is too large to read inline.
- Checked-in `fixtures/<case>/` repos use root `skillset.yaml` and source under `.skillset/`.
- Plugins, standalone skills, rules, hooks, shared files, and provider source in checked-in fixtures should use `.skillset/plugins`, `.skillset/skills`, `.skillset/rules`, `.skillset/hooks`, `.skillset/shared`, and `.skillset/_claude` / `.skillset/_codex`.
- Inline temp fixtures should use the same shape unless the test is specifically covering retired-layout migration behavior.

## Working Loop

1. Read `fixtures/README.md` before changing fixture layout or adding checked-in cases.
2. Keep `fixtures/kitchen-sink/` broad as the positive golden reference; add a new `fixtures/<case>/` instead of overloading it for lifecycle or negative cases.
3. Keep inline temp fixtures near the checks that depend on them unless the case meets the checked-in fixture bar.
4. Do not hand-edit generated output to fix fixture behavior. Change source fixtures or tests, then run the relevant checks.

## Verification

- For docs-only fixture changes, run `bun run check`.
- For compiler behavior changes, run the smallest relevant `bun run test:focused -- apps/skillset/src/__tests__/<file>.test.ts` first, then `bun run check`.
- If self-hosted source under `.skillset/` changes, run `bun run skillset:build`, inspect generated output, then run `bun run check`.

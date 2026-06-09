---
description: Work on Skillset's own compiler test fixtures, fixture docs, fixture-backed tests, or fixture layout decisions in this repo.
metadata:
  generated: skillset@0.1.0
  version: 0.1.1
name: skillset-repo-test-fixtures
---

# Skillset Repo Test Fixtures

Use this skill when changing Skillset's internal compiler fixtures, fixture documentation, or tests whose setup builds fake `.skillset/` repos.

## Fixture Boundary

- Fixtures are internal compiler test material, not product `.skillset/tests/` source.
- Prefer inline temp fixtures in `src/__tests__/` for focused positive cases, negative diagnostics, and lifecycle edge cases.
- Add checked-in `fixtures/<case>/` repos only when a case needs whole-repo inspection, is shared as a golden reference, or is too large to read inline.
- Do not treat `.skillset/src/` as a universal source root. In fixtures it is only for project agents and target-native islands.
- Plugins, standalone skills, and instructions should use their current `.skillset/plugins`, `.skillset/skills`, and `.skillset/instructions` locations.

## Working Loop

1. Read `fixtures/README.md` before changing fixture layout or adding checked-in cases.
2. Keep `fixtures/kitchen-sink/` broad as the positive golden reference; add a new `fixtures/<case>/` instead of overloading it for lifecycle or negative cases.
3. Keep inline temp fixtures near the assertions that depend on them unless the case meets the checked-in fixture bar.
4. Do not hand-edit generated output to fix fixture behavior. Change source fixtures or tests, then run the relevant checks.

## Verification

- For docs-only fixture changes, run `bun run check`.
- For compiler behavior changes, run the smallest relevant `bun test src/__tests__/<file>.test.ts` first, then `bun run check`.
- If self-hosted source under `.skillset/` changes, run `bun run skillset:build`, inspect generated output, then run `bun run check`.

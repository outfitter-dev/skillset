---
title: Skillset Repo Test Fixtures
description: Work on Skillset's own compiler test fixtures, fixture docs, fixture-backed tests, or fixture layout decisions in this repo.
version: 0.1.0
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
- Build Git-backed fixtures with `scripts/test-helpers/git-remote.ts`: create the parent with `createTestGitFixtureRoot()`, create a fresh child beneath it, and pass the parent as `disposableRoot` to `initializeTestGitRepository()` or `createTestGitRemote()`.
- Never run fixture `git init`, identity configuration, or commits against an arbitrary temp path. The shared helper proves sandbox ownership and rejects symlinks, existing repositories, bare repositories, linked worktrees, shared Git common directories, and the Skillset checkout before mutation.
- Keep `HOME` unchanged. Repository verification owns empty global and system Git config files inside the test sandbox, disables prompts, and strips command-line config injection so host signing, hooks, templates, credentials, includes, excludes, attributes, default-branch policy, and identity cannot affect fixtures.

## Working Loop

1. Read `fixtures/README.md` before changing fixture layout or adding checked-in cases.
2. Keep `fixtures/kitchen-sink/` broad as the positive golden reference; add a new `fixtures/<case>/` instead of overloading it for lifecycle or negative cases.
3. Keep inline temp fixtures near the checks that depend on them unless the case meets the checked-in fixture bar.
4. Do not hand-edit generated output to fix fixture behavior. Change source fixtures or tests, then run the relevant checks.

## Verification

- For docs-only fixture changes, run `bun run check`.
- For compiler behavior changes, run the smallest relevant `bun run test:focused -- apps/skillset/src/__tests__/<file>.test.ts` first, then `bun run check`.
- If self-hosted source under `.skillset/` changes, run `bun run skillset:build`, inspect generated output, then run `bun run check`.

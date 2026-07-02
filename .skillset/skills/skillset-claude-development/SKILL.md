---
title: Skillset Claude Development
description: Develop and review the local skillset compiler from a Claude-oriented workflow.
version: 0.1.0
claude: true
codex: false
---

# Skillset Claude Development

Use this skill when working on the local `skillset` compiler from a Claude-oriented workflow.

## Working Context

- The compiler repo is `/path/to/skillset`.
- `.skillset/` and `skillset.yaml` are source truth/state for this repo's own generated skills and plugin.
- `.skillset/`, `plugins/`, `.claude/skills`, `.agents/skills`, and `.cursor/skills` are generated or operational outputs when self-building this repo.
- Do not publish, globally install, symlink, or mutate user-level provider config as part of normal development.

## Development Loop

1. Read `AGENTS.md`, `README.md`, `docs/layout.md`, and `docs/schema-contracts.md` before making a compiler contract change.
2. For source contract changes, update `packages/schema/src/contracts.ts` and `packages/schema/src/validate.ts` before compiler or Workbench consumers, regenerate artifacts with `bun run schema:generate`, and verify with `bun run schema:check`.
3. Keep source edits in `.skillset/`, `skillset.yaml`, or compiler implementation files, not in generated outputs.
4. After source changes, run `bun run skillset:build`.
5. Verify with `bun run skillset:check`, `bun run skillset:verify`, `bun run skillset:lint`, and `bun run check`.
6. If generated output is stale, rebuild from source and inspect the generated diff before committing.

## Review Focus

- Schema and resolver behavior should reject ambiguous source contracts, and shared structural validation should live in `@skillset/schema` rather than parallel compiler or Workbench field lists.
- Configured generated destination roots should never delete or write outside the repo or inside `.skillset/`, `.skillset/cache/`, or `.skillset/snapshots/`. Skillset-owned operational cache paths are reported under `.skillset/cache/` but physically resolve to the repo's XDG cache bucket; Git-backed recovery snapshots may live under `.skillset/snapshots/`.
- Claude-specific dynamic context should not leak into non-Claude provider outputs without an explicit fallback.
- Generated skill frontmatter should stay light: `metadata.version` and `metadata.generated`.

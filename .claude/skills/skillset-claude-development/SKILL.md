---
description: Internal standalone skill for Claude-oriented development of the
  skillset compiler.
metadata:
  generated: skillset@0.1.0
  version: 0.1.0
name: skillset-claude-development
---

# Skillset Claude Development

Use this skill when working on the local `@galligan/skillset` compiler from a Claude-oriented workflow.

## Working Context

- The compiler repo is `/Users/mg/Developer/galligan/skillset`.
- `.skillset/` is source truth for this repo's own generated skills and plugin.
- `plugins-claude/`, `plugins-codex/`, `.claude/skills`, and `.agents/skills` are generated outputs when self-building this repo.
- Do not publish, globally install, symlink, or mutate user-level Claude/Codex config as part of normal development.

## Development Loop

1. Read `AGENTS.md`, `README.md`, and `docs/layout.md` before making a compiler contract change.
2. Keep source edits in `.skillset/` or compiler implementation files, not in generated outputs.
3. After source changes, run `bun run skillset:build`.
4. Verify with `bun run skillset:check`, `bun run skillset:lint`, and `bun run check`.
5. If generated output is stale, rebuild from source and inspect the generated diff before committing.

## Review Focus

- Schema and resolver behavior should reject ambiguous source contracts.
- Build output should never delete or write outside the repo or inside `.skillset/`.
- Claude-specific dynamic context should not leak into Codex-enabled skills without an explicit fallback.
- Generated skill frontmatter should stay light: `metadata.version` and `metadata.generated`.

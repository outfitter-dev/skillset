---
description: Develop and review the local skillset compiler from a Codex-oriented workflow.
metadata:
  generated: skillset@0.1.0
  version: 0.1.0
name: skillset-codex-development
---

# Skillset Codex Development

Use this skill when working on the local `skillset` compiler from a Codex-oriented workflow.

## Working Context

- Work in `/Users/mg/Developer/outfitter/skillset`.
- Treat `.skillset/` as editable source.
- Treat `plugins-claude/`, `plugins-codex/`, `.claude/skills`, and `.agents/skills` as generated outputs.
- Do not hand-edit generated outputs as source truth.
- Do not publish, globally install, symlink, or mutate user-level Claude/Codex config during normal repo work.

## Implementation Loop

1. Inspect the closest existing code path before editing. The core modules are `src/resolver.ts`, `src/render.ts`, `src/build.ts`, `src/config.ts`, `src/lint.ts`, and `src/import.ts`.
2. Add or update fixtures in `src/__tests__/skillset.test.ts` for every behavior change.
3. For source-only skill/plugin edits, run `bun run skillset:build`.
4. Run `bun run check` before handoff.
5. Report generated file counts and any skipped checks explicitly.

## Safety Checks

- Output roots must stay inside the repo, outside `.skillset/`, and unique per active target output.
- `skillset import` should copy into source layout only and refuse to overwrite existing source.
- `targets:` is not supported; use top-level `claude` and `codex`.
- `skillset.name` is preferred. `skillset.id` is only a compatibility alias.

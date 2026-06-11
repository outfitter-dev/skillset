---
title: Skillset Codex Development
description: Develop and review the local skillset compiler from a Codex-oriented workflow.
version: 0.1.0
claude: false
codex: true
---

# Skillset Codex Development

Use this skill when working on the local `skillset` compiler from a Codex-oriented workflow.

## Working Context

- Work in `/path/to/skillset`.
- Treat `.skillset/` as editable source.
- Treat `plugins-claude/`, `plugins-codex/`, `.claude/skills`, and `.agents/skills` as generated outputs.
- Do not hand-edit generated outputs as source truth.
- Do not publish, globally install, symlink, or mutate user-level Claude/Codex config during normal repo work.

## Implementation Loop

1. Inspect the closest existing code path before editing. The core modules are `apps/skillset/src/resolver.ts`, `apps/skillset/src/render.ts`, `apps/skillset/src/build.ts`, `apps/skillset/src/config.ts`, `apps/skillset/src/lint.ts`, and `apps/skillset/src/import.ts`.
2. Add or update focused tests or fixtures in the appropriate `apps/skillset/src/__tests__/` file for every behavior change.
3. For source-only skill/plugin edits, run `bun run skillset:build`.
4. Run `bun run check` before handoff.
5. Report generated file counts and any skipped checks explicitly.

## Safety Checks

- Output roots must stay inside the repo, outside `.skillset/`, and unique per active target output.
- `skillset import` should copy into source layout only and refuse to overwrite existing source.
- Use root `compile.targets` for provider selection. Do not add bare top-level `targets:`.
- Keep target adapter config and defaults in `claude` / `codex` blocks; root `defaults.<target>` is shorthand, not provider selection.
- Use target-specific `claude.model`, `codex.model`, or defaults for model choices. Top-level skill `model` warns in v1.
- `compile.unsupported` defaults to `error`; `warn`, `skip`, and `force` are reserved until provenance exists.
- Use `skillset.name` for root/plugin explicit identity. `skillset.id` is unsupported.

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
- Treat `skillset/`, `skillset.yaml`, and `skillset/changes/` as editable source/state.
- Treat `.skillset/`, `plugins-claude/`, `plugins-codex/`, `.claude/skills`, and `.agents/skills` as generated or operational output.
- Do not hand-edit generated outputs as source truth.
- Do not publish, globally install, symlink, or mutate user-level Claude/Codex config during normal repo work.

## Implementation Loop

1. Inspect the closest existing code path before editing. The core modules are `apps/skillset/src/resolver.ts`, `apps/skillset/src/render.ts`, `apps/skillset/src/build.ts`, `apps/skillset/src/config.ts`, `apps/skillset/src/lint.ts`, and `apps/skillset/src/import.ts`.
2. Add or update focused tests or fixtures in the appropriate `apps/skillset/src/__tests__/` file for every behavior change.
3. For source-only skill/plugin edits, run `bun run skillset:build`.
4. Run `bun run skillset:check` for current source authoring diagnostics and `bun run skillset:verify` for generated-output freshness when the change touches Skillset source, generated output, or docs/guidance that explain the command boundary.
5. Run `bun run check` before handoff.
6. Report generated file counts and any skipped checks explicitly.

## Safety Checks

- Configured generated destination roots must stay inside the repo, outside `skillset/`, `skillset/changes/`, `.skillset/cache/`, and `.skillset/snapshots/`, and unique per active target output. Skillset-owned operational output may live under `.skillset/cache/`, and recovery backups may live under `.skillset/snapshots/`.
- `skillset import` should copy into source layout only and refuse to overwrite existing source.
- Use root `compile.targets` for provider selection. Do not add bare top-level `targets:`.
- Keep target adapter config and defaults in `claude` / `codex` blocks; root `defaults.<target>` is shorthand, not provider selection.
- Use target-specific `claude.model`, `codex.model`, or defaults for model choices. Top-level skill `model` warns in v1.
- `compile.unsupportedDestination` defaults to `error`, which gates unsupported/lossy/failed render from structured render results before writes; `warn`, `skip`, and `force` are reserved until their non-error semantics are implemented.
- Use `skillset.name` for root/plugin explicit identity. `skillset.id` is unsupported.

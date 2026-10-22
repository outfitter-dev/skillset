# References

## Primary Audit Evidence

- Claude audit run:
  `/path/to/claude-transcript.jsonl`
- Crew summary from run `2b6f6349`:
  - result: direction sound, no P0s, one P1, several P2s;
  - top priority: kitchen-sink fixture before adding more surface area;
  - checks passed in both `skillset` and `agents`.

## Local Repo Guidance

- `/path/to/skillset/AGENTS.md`
- `/path/to/skillset/README.md`
- `/path/to/skillset/docs/layout.md`
- `/path/to/skillset/package.json`

## Audit Findings To Address

### P1

- Hook compatibility is unvalidated:
  - `src/render.ts` `validateHookJson` only validates valid JSON object shape;
  - Codex hook support is narrower than Claude's target-native hook support;
  - add lint/tests rather than trusting pass-through content.

### P2

- Resource `to:` mapping can break bare prose links:
  - `src/resources.ts` rewrites `shared:` and `plugin:` scheme links;
  - custom `to` mappings need either bare-link rewrite or clear diagnostics.
- Generated-state guardrails can fail open:
  - corrupt `.skillset.lock` should not disable stale cleanup or unmanaged
    overwrite protection;
  - path existence checks should not swallow real file system errors as absence.
- Locale-dependent ordering:
  - several code paths sort with `localeCompare`, including lock/hash-related
    ordering.
- Documentation drift:
  - future changelog/version workflow belongs to PAT-52;
  - global/XDG managed installs belong to PAT-47;
  - PAT-43 semver/version drift should be treated as completed where it is done;
  - surface matrix should mark implemented vs aspirational rows.

### P3

- `render.ts` is large and mixes many responsibilities.
- Output-root prefix logic and path handling are duplicated.
- Rule base derivation has edge cases around dot heuristics and literal glob
  characters.
- Direct tests are missing for traversal and slug rejection.

## Source Hotspots

- `src/render.ts`
  - `renderPluginSkillFiles`
  - `renderStandaloneSkill`
  - `copyPluginCompanionFiles`
  - `validateHookJson`
  - `hasGlobSyntax`
  - `dirnameOrRoot`
  - lock and hash rendering helpers
- `src/resources.ts`
  - `readSkillResources`
  - `rewriteResourceLinks`
- `src/build.ts`
  - `readWorkspaceManagedPaths`
  - stale cleanup and unmanaged overwrite protection
- `src/lint.ts`
  - dynamic-context lint pattern to mirror for hook compatibility
- `src/skill-policy.ts`
  - existing target-aware validation and metadata lowering patterns
- `src/path.ts`
  - `resolveInside`
  - `validateSlug`
- `src/__tests__/skillset.test.ts`
  - existing fixture style and coverage to extend or split

## Target Surface Evidence

Live docs checked on 2026-06-03 for closeout:

- Codex hooks:
  `https://developers.openai.com/codex/hooks`
  - Current Codex events: `PreToolUse`, `PermissionRequest`, `PostToolUse`,
    `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`,
    `SessionStart`, and `SubagentStart`.
  - Only synchronous `command` handlers run today; prompt handlers, agent
    handlers, and `async: true` command handlers are parsed but skipped.
  - Codex plugin hooks default to `hooks/hooks.json` inside the plugin root, but
    the plugin manifest can override that path.
- Claude Code hooks:
  `https://code.claude.com/docs/en/hooks`
  - Claude's hook surface is wider and evolving; generated Claude hook
    validation therefore remains shape-only rather than event-strict.

Local snapshots from the audit:

- `/path/to/research/library/agent-skills/specification.md`
- `/path/to/research/library/claude-code/skills.md`
- `/path/to/research/library/claude-code/plugins-reference.md`
- `/path/to/research/library/claude-code/plugin-marketplaces.md`
- `/path/to/research/library/codex/skills.md`
- `/path/to/research/library/codex/guides--agents-md.md`
- `/path/to/research/library/codex/rules.md`
- `/path/to/research/library/codex/subagents.md`
- `/path/to/research/library/codex/cli--reference.md`

Prior research note:

- `/path/to/research/notes/2026-06-01-claude-codex-agent-surface-map.md`

## Validation Commands

```bash
bun run skillset:build
bun run skillset:check
bun run skillset:lint
bun run typecheck
bun test
bun run check
git diff --check
```

## Forbidden Side Effects

- No publish.
- No install/trust/symlink into global Claude or Codex locations.
- No user-level Claude/Codex config mutation.
- No remote add, push, PR, or merge without the maintainer's approval.
- No legacy GitButler, Obsidian, global-skill, or `agents` migration.
- No hand-editing generated output as source truth.

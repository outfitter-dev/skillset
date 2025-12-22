# wskill

Deterministic Skill invocation for Claude Code via `w/<alias>` syntax.

## When to use

- You want explicit control over which Skill loads.
- You see ambiguous or missing skill messages and need a deterministic path.
- You’re combining multiple Skills in one prompt (e.g., `w/frontend-design w/ship`).

## How to use

1. Add `w/<alias>` in your prompt. Examples: `w/frontend-design`, `w/ship`.
2. Optional namespaces: `w/<namespace>:<alias>` if collisions occur.
3. The plugin hook injects the resolved SKILL.md content as context blocks. Ignore the literal `w/...` tokens afterwards.

## Helpful commands

- `/wskill:index` — rescan Skills and refresh cache.
- `/wskill:manage` — pin aliases or resolve collisions.
- `/wskill:doctor` — show unmatched/ambiguous history and suggestions.
- `/with-skill` — friendly entry point if you forget the above.

## Notes

- Skills inside code fences are ignored to avoid accidental triggers.
- In strict mode, ambiguous or missing invocations block the prompt; default is warn mode.
- Structures are cached for speed. TTL defaults to 1 hour.

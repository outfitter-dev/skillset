# skillset

Deterministic Skill invocation for Claude Code via `$<alias>` syntax.

## When to use

- You want explicit control over which Skill loads.
- You see ambiguous or missing skill messages and need a deterministic path.
- You're combining multiple Skills in one prompt (e.g., `$frontend-design $ship`).

## How to use

1. Add `$<alias>` in your prompt. Examples: `$frontend-design`, `$ship`.
2. Optional namespaces: `$<namespace>:<alias>` if collisions occur.
3. The plugin hook injects the resolved SKILL.md content as context blocks. Ignore the literal `$...` tokens afterwards.

## Helpful commands

- `/skillset:index` — rescan Skills and refresh cache.
- `/skillset:manage` — pin aliases or resolve collisions.
- `/skillset:doctor` — show unmatched/ambiguous history and suggestions.
- `/with-skill` — friendly entry point if you forget the above.

## Notes

- Skills inside code fences are ignored to avoid accidental triggers.
- In strict mode, ambiguous or missing invocations block the prompt; default is warn mode.
- Structures are cached for speed. TTL defaults to 1 hour.

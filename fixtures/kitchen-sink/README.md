# Kitchen Sink Fixture

A durable `.skillset/` source tree that exercises the implemented compiler
surfaces in one build. Tests copy `.skillset/` into a temp repo and build it, so
the fixture proves real behavior without touching the repo's own self-hosted
source or `galligan/agents`.

Surfaces covered:

- plugin-local shared resources, including a custom `from` / `to` mapping
  (`plugin:templates/report.md` → `docs/report.md`);
- prose links rewritten through that custom mapping;
- Claude hook definitions (`hooks/hooks.json`) and Codex hook definitions
  (root `hooks.json`) with valid target-native events and command handlers;
- `.mcp.json` for both targets;
- a Claude-only `commands/` companion and a Codex-only `.app.json` companion;
- rules that lower to Claude `.claude/rules/**` and Codex `AGENTS.md` files,
  including build-time `{{skillset.*}}` variable rendering.

The fixture is intentionally valid so it builds; negative cases (ambiguous
remapped bare links, Codex-incompatible hook events/handlers) live as dedicated
tests in `src/__tests__/`.

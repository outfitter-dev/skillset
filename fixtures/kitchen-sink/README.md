# Kitchen Sink Fixture

A durable fake repo with a dedicated `skillset/` source tree that exercises implemented compiler surfaces in one build. Tests copy the fixture into a temp repo and build it, so the fixture proves compiler behavior without touching the repo's own self-hosted source or an example content repo.

This is an internal compiler fixture, not a product-level `.skillset/tests/` case. Product dogfooding should use real workspace source changes and the public validation/change/release commands. See [Internal Fixtures](../README.md) for the fixture convention and the checked-in-vs-inline decision rule.

Surfaces covered:

- plugin-local shared resources, including a custom `from` / `to` mapping
  (`plugin:templates/report.md` → `docs/report.md`);
- prose links rewritten through that custom mapping;
- shared hook definitions (`hooks/hooks.json`) with valid target-native events
  and command handlers;
- `.mcp.json` for both targets;
- a Claude-only `commands/` companion and a Codex-only `.app.json` companion;
- rules that lower to Claude `.claude/rules/**` and Codex `AGENTS.md` files,
  including build-time `{{skillset.*}}` variable rendering.

The fixture is intentionally valid so it builds; negative cases (ambiguous remapped bare links, Codex-incompatible hook events/handlers) live as dedicated tests in `src/__tests__/`.

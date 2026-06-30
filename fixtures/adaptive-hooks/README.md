# Adaptive Hooks Fixture

This fixture is a positive authoring fixture for adaptive hook recipes. It uses
the current Skillset workspace layout and covers:

- plugin-level adaptive hook attachments;
- flat and directory adaptive hook units;
- `hooks.auto` expansion;
- attachment status messages and matchers;
- `context.strategy: toolkit` runtime context rendering;
- `{{scripts.dir}}` and hook-local `./` script references;
- Claude skill-local and project-agent frontmatter hooks;
- a separate native aggregate plugin using `hooks/hooks.json`.

Unsupported adaptive hook destinations are covered by inline policy tests rather
than this buildable fixture.

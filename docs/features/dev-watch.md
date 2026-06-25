# Dev Watch

Feature id: `dev-watch`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

`skillset dev --watch` runs a preview-only authoring loop for first authors. It
watches the active Skillset workspace source and config paths, debounces edits,
and reruns the same safe source diagnostics and generated-output preview used by
the rest of the CLI.

## Authoring

Start the loop from a nested or root-layout Skillset workspace:

```bash
skillset dev --watch
```

For another checkout, pass `--root`:

```bash
skillset dev --watch --root examples/first-author
```

The command watches:

- the workspace config, such as `.skillset/skillset.yaml` or `skillset.yaml`;
- the active source root, such as `.skillset/src/` or `skillset/`.

It ignores generated output roots, `AGENTS.md`, `skillset.lock`, `.skillset/cache/`,
`.skillset/snapshots/`, and generated lock/report churn so preview output does
not trigger itself.

## Target Rendering

`skillset dev --watch` does not render or write target files. Each refresh
prints:

- source diagnostics;
- generated-output drift that `skillset build` would write;
- active output roots where generated files would land.

Use `skillset build --yes` when the preview is acceptable and you want to write
repo-local Claude/Codex generated output.

## Diagnostics

The watch loop reports source errors without exiting the process. Fix the file
and save again to rerun the preview. Build/render errors are shown as preview
errors; no generated files, source files, hooks, scripts, runtime settings, trust
state, or user-level Claude/Codex config are mutated.

`skillset dev --watch` is intentionally not a daemon, background service,
runtime activation layer, or provider-specific live preview. It ends when the
foreground process receives `SIGINT` or `SIGTERM`.

## Tests and Fixtures

Tests cover nested and root-layout watch path selection, generated/cache/output
ignore rules, debounce behavior with a fake scheduler, preview summary rendering,
and command validation without starting a long-running watcher.

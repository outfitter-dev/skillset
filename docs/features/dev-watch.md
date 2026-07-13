# Dev Watch

Feature id: `dev-watch`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

`skillset dev` runs a foreground authoring loop for first authors. It
watches the active Skillset workspace source and config paths, debounces edits,
and reruns source diagnostics plus generated-output checks as files change. The
default mode is preview-only; `--write` opts into writing repo-local generated
output on each clean refresh.

## Authoring

Start the loop from a Skillset workspace:

```bash
skillset dev
```

To apply generated output after each source edit, opt in explicitly:

```bash
skillset dev --write
```

For another checkout, pass `--root`:

```bash
skillset dev --root examples/first-author
```

The command watches:

- the workspace config, `skillset.yaml`;
- the active source root, `.skillset/`.

It ignores generated output roots, `AGENTS.md`, `skillset.lock`,
`.skillset/cache/`, `.skillset/snapshots/`, and generated lock/report churn so
preview and apply output do not trigger the watcher.

## Target Rendering

Preview mode does not render or write target files. Each refresh prints:

- source diagnostics;
- generated-output drift that `skillset build` would write;
- active output roots where generated files would land.

Use `skillset build --yes` when the preview is acceptable and you want to write
repo-local generated provider output.

Apply mode uses the same build path as `skillset build --yes`. It writes only
repo-local generated output, uses generated-output ownership checks, creates
reversible backups for unmanaged collisions or target-side edits, and reports
the `skillset restore <backup-id>` recovery command when a backup is created.
`--write` is the continuous-write opt-in; bare `dev` remains preview-only and
does not accept `--yes`.

## Diagnostics

The watch loop reports source errors without exiting the process. Fix the file
and save again to rerun the preview or apply refresh. Build/render errors are
shown inline. In apply mode, a failed refresh reports that no completed apply was
recorded and points at restore if an earlier backup was reported.

`skillset dev` is intentionally not a daemon, background service,
runtime activation layer, or provider-specific live preview. It ends when the
foreground process receives `SIGINT` or `SIGTERM`.

Neither preview nor apply mode installs, trusts, activates, symlinks, publishes,
executes hooks/scripts, or mutates user-level Claude, Codex, or Cursor
configuration.

## Tests and Fixtures

Tests cover workspace watch path selection, generated/cache/output ignore rules,
debounce behavior with a fake scheduler, preview summary rendering, apply writes,
backup recovery guidance, and command validation without starting a long-running
watcher.

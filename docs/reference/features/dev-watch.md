---
description: Skillset development mode watches source, previews drift, and optionally writes generated output.
---

# Dev Watch

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `dev-watch` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

`skillset dev` runs a foreground authoring loop over the active Skillset [workspace](../../glossary.md#workspace). It debounces changes to `skillset.yaml` and `.skillset/`, then reruns source diagnostics and [generated-output](../../glossary.md#generated-output) checks.

## Preview by Default

```bash
skillset dev
```

Each refresh reports source diagnostics, generated-output [drift](../../glossary.md#drift), and the active output roots. Preview mode writes nothing. Use a separate confirmed build when the plan is ready:

```bash
skillset build --yes
```

The [development-loop guide](../../guides/development-loop.md) owns the complete author workflow, and the generated [`dev` reference](../cli/dev.md) owns exact syntax.

## Opt Into Continuous Writes

```bash
skillset dev --write
skillset dev --root examples/first-author
```

`--write` uses the same repo-local build path and ownership checks as `skillset build --yes` on every clean refresh. It can create reversible backups for collisions or edited managed files. Bare `dev` does not accept `--yes`; `--write` is the explicit continuous-write choice.

The watcher ignores generated roots, `AGENTS.md`, `skillset.lock`, `.skillset/cache/`, `.skillset/snapshots/`, and its own report churn so a build does not retrigger itself.

## Errors and Exit Behavior

- Source and render errors are printed without ending the watch process. Fix the file and save to retry.
- A failed write refresh records no completed write. If an earlier refresh created a backup, the report includes the [`restore`](../cli/restore.md) command.
- `SIGINT` or `SIGTERM` ends the foreground process normally; `dev` is not a daemon.
- Invalid flags or an invalid workspace fail before the watcher starts.

`skillset dev` never installs, trusts, activates, symlinks, publishes, executes generated hooks or scripts, or mutates user-level provider configuration. Writing proves only that the repository [projection](../../glossary.md#projection) is current; see [Build Versus Activation](../../start/build-versus-activation.md).

## Provenance

Write mode updates ordinary generated files and their nearby `skillset.lock` records. Preview mode creates no provenance. Collision and target-side-edit recovery evidence belongs to the snapshot described by [Output Safety](output-safety.md).

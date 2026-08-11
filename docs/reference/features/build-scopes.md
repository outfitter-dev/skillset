---
description: Build scopes select generated destinations for preview, writing, inspection, and isolated builds.
---

# Build Scopes

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `workflows` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Registry feature: `workflows`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

A build scope filters the [destinations](../../glossary.md#destination) that Skillset previews, writes, or inspects. It does not change [canonical source](../../glossary.md#canonical-source), provider meaning, or source-change coverage.

## Choose a Build Mode

Root `skillset.yaml` sets the default mode:

```yaml
compile:
  build: updated
```

`updated` is the default and selects missing, changed, or stale managed output. `all` selects every configured generated file. `--updated` and `--all` override the manifest for one command and cannot be combined.

`skillset build` is plan-first. It writes only after interactive confirmation or `--yes`:

```bash
skillset build
skillset build --yes
```

The generated [`build` reference](../cli/build.md) owns the exact flags. The [development loop](../../guides/development-loop.md) shows the normal preview, write, and check sequence.

## Filter Destinations

`--scope` filters destination classes for `build`, `diff`, `list`, and `explain`:

| Scope     | Selected destination                              |
| --------- | ------------------------------------------------- |
| `repo`    | Repo-local standalone generated skill roots       |
| `plugins` | Generated plugin bundles                          |
| `project` | Project instructions, agents, and provider source |
| `user`    | Reserved; no build output exists today            |
| `all`     | Every configured destination                      |

Scopes are not entity selectors. They cannot substitute for plugin or skill ids, and `change status` and `change check` reject them because those commands measure source coverage rather than generated destinations.

## Use an Isolated Mirror

`--isolated` on `build`, `diff`, or `check --only outputs` reroots the complete [projection](../../glossary.md#projection) under the logical `.skillset/cache/latest/` mirror in the repository's XDG cache bucket. Reports and locks retain repository-relative paths, while live generated roots remain untouched.

Writes, [drift](../../glossary.md#drift) checks, stale-file removal, collision backups, and locks operate against the mirror. This is useful for inspection and tests; it does not install or activate the result.

## Read the Result

| Command | Result | Writes |
| --- | --- | --- |
| `skillset build` | Planned additions, changes, missing files, and removals | Only after confirmation or `--yes` |
| `skillset diff` | Content and state differences | Never |
| `skillset list` | Lock-backed generated inventory | Never |
| `skillset explain <path>` | Source, destination, provenance, and [render-result](../../glossary.md#render-result) facts | Never |
| `skillset check --only outputs` | Whether checked-in output matches source | Never |

Missing managed output appears separately from newly [generated output](../../glossary.md#generated-output). Unsupported or lossy destinations fail unless the [workspace](../../glossary.md#workspace) has an explicit visible policy that permits the result.

## Errors and Recovery

| Problem | Result | Recovery |
| --- | --- | --- |
| Unknown scope | Command fails instead of guessing | Choose a scope from the table or omit `--scope` |
| Conflicting build modes | Command fails | Pass only `--updated` or `--all` |
| Missing lock | Preview derives the configured projection; a confirmed build writes a new baseline | Review the full plan before confirming |
| Corrupt lock | Build and inspection fail because ownership is unsafe to infer | Repair or regenerate the lock from trusted source |
| Missing managed file | Diff and output check report the missing path | Preview and confirm a build |
| Unmanaged collision or edited output | Confirmed build creates a recovery snapshot before replacement | Follow [Output Safety](output-safety.md) |

Dry-run commands never write generated files, locks, [target](../../glossary.md#target) configuration, or user-level settings.

## Provenance

Nearby `skillset.lock` files record resolved build mode, source and generated hashes, target state, preprocessing dependencies, warnings, and skipped or unsupported facts. Generated frontmatter remains lightweight; use [`status`](../cli/status.md) or [`explain`](../cli/explain.md) to inspect the lock-backed decision.

---
description: Skillset distributions plan downstream delivery of built artifacts without syncing, publishing, or activating them.
---

# Distributions

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `distributions` | `implemented` | `not_applicable` | `not_applicable` | `planned` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

A distribution describes where an already-built [projection](../../glossary.md#projection) could be delivered. Skillset currently implements planning only: it does not sync files, commit to another repository, publish, install, or prove [activation](../../glossary.md#activation).

Use a distribution when generated artifacts need a downstream filesystem or Git [destination](../../glossary.md#destination). Use a [marketplace](../../guides/marketplaces.md) to curate provider catalog entries, and use the [publishing guide](../../guides/publishing.md) to choose among [workspace](../../glossary.md#workspace) releases, distributions, marketplaces, and npm publication.

## Configure a Distribution

`distributions` is a root `skillset.yaml` field, separate from `compile`:

```yaml
compile:
  targets: [codex]

distributions:
  codex-marketplace:
    from:
      target: codex
      runtime: codex-cli
      selector: plugin:skillset
    to:
      kind: local
      path: ../openai-codex-plugins/skillset
      subdirectory: packages/skillset
```

`from.target` must be enabled by `compile.targets`. Optional `from.runtime` records intended consumer evidence; it does not add a build target or prove runtime readiness.

| Selector      | Selected generated surface                                |
| ------------- | --------------------------------------------------------- |
| `plugin:<id>` | One provider plugin bundle, relative to its bundle root   |
| `plugins`     | The provider's complete generated plugin output root      |
| `skill:<id>`  | One standalone provider skill, relative to its skill root |

`to.kind: local` requires `path`. `to.kind: git` requires `repo`; `branch` and `subdirectory` are metadata for a future sync workflow. Exact field shapes live in the generated [workspace schema](../schemas/README.md).

## Plan the Delivery

```bash
skillset distribute plan codex-marketplace
skillset distribute plan codex-marketplace --json
```

A plan reports the target, selector, destination, file hashes, ownership, and destination status. Local files are `add`, `change`, or `unchanged`; Git destination files remain `unknown` because the command does not fetch or check out the repository.

The generated [`distribute` reference](../cli/distribute.md) owns exact syntax. There is no `distribute sync`, apply, or publish command today. Write-oriented build flags such as `--yes`, `--updated`, `--all`, and `--scope` are rejected.

## Preserve Destination Ownership

Selected files can contain different ownership classes:

| Class | Meaning |
| --- | --- |
| `source-owned` | Directly selected Skillset source output |
| `generated` | Derived by Skillset and replaceable from source |
| `destination-owned` | Controlled by the downstream repository and preserved by default |
| `overlay` | Intentionally enriched downstream with explicit precedence |
| `ignored` | Known but deliberately excluded |

Unknown downstream manifest fields are conservative destination-owned data. A plan can report presentation assets or metadata that a future sync must preserve; it never treats the whole destination as disposable.

## Errors and Recovery

| Problem | Result | Recovery |
| --- | --- | --- |
| Target is disabled | Plan fails | Enable the target or choose one already in `compile.targets` |
| Distribution, plugin, or skill is unknown | Plan fails | Correct the id or selector |
| Selector produces no files | Plan fails rather than creating an empty delivery | Build and verify the selected source/target |
| Path or subdirectory is unsafe | Validation fails | Use a normalized repository-relative subdirectory and an explicit destination root |
| Local path is absent | Plan reports additions against an empty destination | Create/review the destination outside Skillset before any future sync |
| Git repository is unavailable | File status remains `unknown`; no network action occurs | Inspect the Git destination separately |

## Provenance

The plan derives files and hashes from the current in-memory rendering. It does not write destination state or a delivery lock. Runtime and harness support records remain separate from compile targets in [Runtime Adapters](../../development/features/runtime-adapters.md).

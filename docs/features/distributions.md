# Distributions

Feature id: `distributions`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Distributions describe where an already-built Skillset projection could be synced after build. They are separate from compilation and separate from runtime activation.

## Lifecycle Boundary

`skillset build` materializes deterministic generated files from source. It does not trust, install, publish, activate, or mutate another repository.

`skillset distribute plan` reads `distributions` config, renders the generated projection in memory, filters the requested source surface, and reports where those files would land. It does not write files, create commits, open pull requests, or install runtime config.

Future sync/publish commands can consume the same plan, but the plan is the contract first: source target, selector, destination, file list, hashes, local destination status when available, and whether the local destination is already a no-op.

## Config

Distribution config is root-level and intentionally not nested under `compile`:

```yaml
compile:
  targets:
    - codex

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

`from.target` is the build target projection to read. It must already be enabled by `compile.targets`.

`from.runtime` is optional evidence for the runtime or harness that will consume the distribution. It does not make the runtime a build target.

`from.selector` currently supports:

| Selector | Meaning |
| --- | --- |
| `plugin:<id>` | A single generated plugin bundle for the selected target, stripped to the plugin bundle root. |
| `plugins` | The selected target's whole generated plugin output root, including marketplace/readme/lock files. |
| `skill:<id>` | A standalone generated skill for the selected target, stripped to the skill root. |

`to.kind: local` requires `to.path`. `to.kind: git` requires `to.repo`; `branch` and `subdirectory` are plan metadata for later sync automation.

## CLI

```bash
skillset distribute plan
skillset distribute plan codex-marketplace
```

The command is always read-only. It rejects build/write flags such as `--yes`, `--dry-run`, `--updated`, `--all`, and `--scope` because those flags belong to build or future sync behavior.

For local destinations the plan reads destination files and marks each file as `add`, `change`, or `unchanged`. For git destinations the file status is `unknown` until a future sync command checks out or fetches the destination.

## Destination Ownership

Distribution plans do not assume every downstream file is Skillset-owned. Files selected from generated output are Skillset-owned candidates, but downstream marketplace metadata, review files, repository settings, and runtime trust state can be destination-owned. SET-110 expands this into an explicit ownership classifier.

## Activation

Distribution does not prove a runtime saw the plugin, skill, or agent. Activation belongs to runtime setup and activation probes, not build or distribution planning.

## Evidence

- [Runtime Adapters](runtime-adapters.md) - runtime support stays beside target support.
- [Tests And Evals](tests-and-evals.md) - activation probes build on test runs instead of distribution.
- [SET-109 contract test](../../apps/skillset/src/__tests__/contract.test.ts) - read-only distribution planning behavior.

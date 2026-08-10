---
description: Configure provider selection and project-wide compiler behavior in skillset.yaml.
---

# Project Configuration

The root `skillset.yaml` defines a Skillset [workspace](../glossary.md#workspace). Authored skills, agents, instructions, plugins, and shared inputs live under its [source root](../glossary.md#source-root), `.skillset/`.

A small manifest can select providers and keep the default [build](../glossary.md#build) policy explicit:

```yaml
compile:
  targets: [claude, codex, cursor]
  build: updated
  unsupportedDestination: error
```

The [workspace-config schema and maximal example](../reference/schemas/README.md) are the exhaustive contract. The sections below cover the choices most projects need to make.

## Select Providers

`compile.targets` establishes the root provider plan; each selected provider becomes a [target](../glossary.md#target). It accepts `claude`, `codex`, and `cursor`. When it is omitted, Skillset uses the default provider plan and builds every supported provider rendering for portable source.

Root provider blocks such as `claude`, `codex`, and `cursor` configure output details and inherit that plan unless explicitly enabled or disabled. Lower-level plugin and [source-unit](../glossary.md#source-unit) provider toggles can opt a provider back in where the source contract supports it. A bare top-level `targets` key is invalid. See [target overrides](target-overrides.md) for the full [cascade](../glossary.md#cascade).

## Choose Build Behavior

`compile.build` accepts `updated` or `all` and defaults to `updated`. Updated mode selects missing or changed [generated output](../glossary.md#generated-output); all mode selects every configured generated file. The command-line `--updated` and `--all` options override the manifest for one run.

Builds are plan-first and write only when confirmed with `--yes`. See the generated [`skillset build` reference](../reference/cli/build.md) for the current command and flags.

## Handle Unsupported Destinations

`compile.unsupportedDestination` controls what happens when a source unit cannot reach a requested [destination](../glossary.md#destination) without an unsupported or lossy result:

- `error` is the default and blocks the build.
- `warn` and `skip` soften unsupported or lossy results and preserve diagnostics.
- `force` permits those results while retaining their provenance.

Failed [render results](../glossary.md#render-result) block every policy. Check current provider behavior in the [support matrix](../reference/support-matrix.md) before softening this setting.

## Configure Generated Metadata and Prompt Arguments

`compile.skillset.metadata` defaults to `true`. Set it to `false` to suppress the generated `metadata.generated` and `metadata.version` fields on rendered skills.

`compile.features.promptArguments` also defaults to `true`. Set it to `false` to reject Skillset-owned `{{$ARGUMENTS...}}` expressions. See the [preprocessing reference](../reference/source/preprocessing.md) for expression and target behavior.

## Configure Other Workspace Features

The manifest also hosts project-wide configuration for [agents](../reference/features/agents.md), [changes](../reference/features/changes.md), [dependencies](../reference/features/dependencies.md), [distributions](../reference/features/distributions.md), [marketplaces](../reference/features/marketplaces.md), and [support constraints](../reference/features/supports.md). Follow those feature pages for behavior and the generated workspace schema for exact field shapes.

## Validate and Inspect

Run [`skillset check`](../reference/cli/check.md) after changing the manifest. Use [`skillset lookup`](../reference/cli/lookup.md) for finite values and schema facts; for example:

```bash
skillset lookup workspace --field compile.targets --values
```

New manifests include a YAML language-server comment pointing at the current workspace schema. Do not add a parallel `$schema` field to authored YAML.

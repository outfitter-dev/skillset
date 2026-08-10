---
description: Traces canonical Skillset source through validation and target rendering into deterministic provider-native destinations.
---

# How Rendering Works

A Skillset [workspace](../glossary.md#workspace) has two authored inputs: `skillset.yaml` selects workspace behavior, and `.skillset/` contains the [canonical source](../glossary.md#canonical-source). Everything Skillset writes is derived from those inputs and explicit operational state.

```text
skillset.yaml + .skillset/
        ↓ resolve and validate
source graph + target support
        ↓ render per target
destination plan
        ↓ explicit confirmation
provider-native files + skillset.lock provenance
```

## Resolve source intent

Skillset loads addressable [source units](../glossary.md#source-unit)—skills, instructions, agents, plugins, hooks, and related resources—into one graph. Workspace and plugin defaults can [cascade](../glossary.md#cascade) into a unit, while narrower explicit configuration wins.

The graph expresses author intent, not a promise that every provider has the same file format or capability.

## Validate before writing

Skillset validates source shape, references, [target](../glossary.md#target) compatibility, [destination](../glossary.md#destination) safety, and ownership before a confirmed [build](../glossary.md#build) writes output. The generated [support matrix](../reference/support-matrix.md) describes registry-owned feature support; it does not guarantee that every source unit can reach every target.

When a target cannot represent an intent faithfully, the build reports that boundary instead of inventing parity. The [feature reference](../reference/features/README.md) explains the public behavior; [render-result internals](../development/features/render-results.md) explain the maintainer contract behind per-build [render-result](../glossary.md#render-result) evidence.

## Render target-native output

Each enabled target [renders](../glossary.md#render) supported source intent into its own [provider-native](../glossary.md#provider-native) shape. In the first-author fixture, one instruction becomes a Claude rule and contributes to Codex `AGENTS.md`; the files differ because the provider surfaces differ.

A destination is the concrete path and format receiving one output. A render is the transformation that produces it. The complete deterministic set is a [projection](../glossary.md#projection).

## Preview, confirm, and record ownership

`skillset build` computes and displays a destination plan. It writes nothing by default. `skillset build --yes` confirms that plan and writes managed files plus nearby `skillset.lock` provenance.

Locks connect source paths, generated paths, hashes, target state, and ownership. They let later checks distinguish managed output from unrelated neighboring files.

## Detect drift

If canonical source changes without regeneration, the expected projection and checked-in files have [drift](../glossary.md#drift). `skillset diff` and preview builds show the change; `skillset check --only outputs` fails until a confirmed build makes output current.

Generated files remain reviewable and committable, but they are not source truth. Edit `.skillset/`, then regenerate. If an intentional target-side edit must become source, use the bounded reconciliation workflow in the [development loop](../guides/development-loop.md).

## Stop at the repository boundary

Deterministic files are not runtime authority. Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](build-versus-activation.md).

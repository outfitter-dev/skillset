---
description: Edits canonical Skillset source, previews and verifies generated output, and routes target-side changes through explicit recovery workflows.
---

# Use the Development Loop

Daily Skillset work moves in one direction: edit [canonical source](../glossary.md#canonical-source), preview the derived [projection](../glossary.md#projection), confirm writes, and review the [generated output](../glossary.md#generated-output) diff.

## Edit, preview, write, verify

After changing `skillset.yaml` or `.skillset/`, run:

```bash
skillset check
skillset diff
skillset build
skillset build --yes
skillset check --only outputs
```

The comprehensive check includes source and generated-output readiness, so it may report expected [drift](../glossary.md#drift) before regeneration. `diff` and bare [build](../glossary.md#build) preview without writing. The confirmed build refreshes owned [destinations](../glossary.md#destination), and the output-only check proves they are current.

Use `skillset explain <path>` when you need the source, [target](../glossary.md#target), ownership, or provenance behind one file. Use `skillset status` for a broader repository summary. Exact syntax belongs to the generated [CLI reference](../reference/cli/README.md).

## Watch while you work

`skillset dev` is a foreground, preview-only loop. It watches [workspace](../glossary.md#workspace) configuration and canonical source, reruns diagnostics, and reports pending output changes.

```bash
skillset dev
```

Use continuous writes only when that is what you intend:

```bash
skillset dev --write
```

Generated output, caches, locks, and backups are not watch inputs, so output churn cannot create a feedback loop. The [Dev Watch reference](../reference/features/dev-watch.md) owns the detailed behavior.

## Keep authority explicit

Ordinary work is source-to-output. Do not edit a generated file and expect build or `check --write` to treat it as source truth.

If a managed target file contains an intentional edit, preview bounded reconciliation:

```bash
skillset reconcile <generated-path> --use output
```

Confirm only a clean, understandable mapping with `--yes`. Use `--use source` when canonical source should win. Skillset may refuse [provider-native](../glossary.md#provider-native), metadata-owned, multi-source, unmanaged, or unsafe reverse mappings; the [source-suggestions reference](../reference/features/source-suggestions.md) explains the boundary.

Provider-format migrations belong to `skillset update`, not ordinary build or reconciliation. Recoverable collision and target-edit backups belong to `skillset restore`; list and preview a restore before confirming it. See [Output Safety](../reference/features/output-safety.md).

## Record meaningful source changes

When the workspace uses Skillset's change ledger, run `skillset change status` after a source change and add the required reason before shipping. The [Changes reference](../reference/features/changes.md) owns ledger and release details.

## Review before committing

- Source checks pass.
- The build preview matches the intended destinations.
- `check --only outputs` passes after the confirmed build.
- Generated files and locks changed only where expected.
- Unsupported or degraded outcomes are understood, not hidden.
- No build result is mistaken for runtime [activation](../glossary.md#activation).

When the loop does not behave as expected, start with [troubleshooting](../troubleshooting.md).

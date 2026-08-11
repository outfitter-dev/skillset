---
description: Diagnoses source errors, generated-output drift, adoption refusals, recovery conflicts, and runtime activation confusion.
---

# Troubleshooting

Start with the symptom you can observe. Preserve the failing output, preview any repair, and keep [canonical source](glossary.md#canonical-source) separate from [generated output](glossary.md#generated-output).

## The `skillset` command is unavailable

Confirm the package is installed in the repository and run it through the package runner:

```bash
bun add --dev skillset
bunx skillset --help
```

If the repository builds Skillset from source, use its documented repository-local command instead. Do not solve a missing binary by copying generated output from another checkout.

## Initialization found provider files but imported nothing

This is expected when `init` only surveyed the repository. Before confirming a plain scaffold, review the candidate ids and rerun the survey as `init --adopt <id|all> --yes`; setup and adoption then happen together. A plain `init --yes` writes the scaffold without adopting reported candidates, and a later survey deliberately stops offering root instruction files once the repository is initialized. If the scaffold already exists, preserve the original guidance while you author its canonical equivalent under `.skillset/rules/` using the [Instructions reference](reference/features/instructions.md), then build and review the generated result before removing the original.

See [Import Existing Work](guides/importing.md) for the difference between whole-repository adoption and direct import.

## Import refused a source path

The path may be ambiguous, unsupported, unsafe, or already owned by existing source. Inspect the reported kind and [destination](glossary.md#destination); add an explicit `--kind` only when you know the directory shape. There is no overwrite mode for existing canonical source.

Use the generated [`import` reference](reference/cli/import.md) for accepted syntax and the [support matrix](reference/support-matrix.md) for current feature support.

## Check reports invalid source or configuration

Fix the first source-positioned diagnostic before trying to [build](glossary.md#build). Common causes include malformed frontmatter, unknown fields, invalid references, unsafe paths, and a [target](glossary.md#target) that cannot represent the source intent.

Use `bunx skillset explain <source-path>` for local provenance. Consult the generated [schemas](reference/schemas/README.md) and the relevant [feature page](reference/features/README.md) instead of weakening validation blindly.

## Check reports generated-output drift

The authored source and expected [projection](glossary.md#projection) have [drift](glossary.md#drift) from the managed files. Preview before writing:

```bash
bunx skillset diff
bunx skillset build
```

If the plan is correct, run `bunx skillset build --yes`, then `bunx skillset check --only outputs`. See [Output Safety](reference/features/output-safety.md) when the plan includes a collision, removal, or backup.

## Build shows output I did not expect

Do not confirm it yet. Run `bunx skillset diff`, `bunx skillset status`, and `bunx skillset explain <path>`. Check the enabled targets, source defaults, and current support before changing configuration.

[How Rendering Works](start/how-rendering-works.md) explains why one source intent can produce different [provider-native](glossary.md#provider-native) destinations.

## A generated file was edited

Ordinary build treats source as authority and may back up the target-side edit. If the edit was intentional, preview `skillset reconcile <path> --use output`; confirm only when the proposed source change is correct. Use `--use source` when the generated edit should be discarded.

Reconciliation is deliberately bounded and may refuse unsafe reverse mappings. See [Source Suggestions](reference/features/source-suggestions.md).

## Skillset reports a provider-format update

Provider format drift is not an ordinary source edit. Use `bunx skillset update` to preview the adopted format migration, inspect its evidence, and confirm with `--yes` only when the plan is safe. Do not use reconciliation to hide a provider-owned contract change.

## One target cannot represent this source

Inspect the feature and target in the [support matrix](reference/support-matrix.md). Narrow the source to compatible targets, use an explicit [target-native island](glossary.md#target-native-island), or record the [workspace's](glossary.md#workspace) visible unsupported-destination policy when degradation is truly acceptable. Do not pretend unlike provider behavior is portable.

## Build replaced or removed a file I need

List integrity-checked backups:

```bash
bunx skillset restore --list
```

Preview `bunx skillset restore <backup-id>` before confirming it with `--yes`. Restore refuses unsafe recovery when the destination changed again. See [Output Safety](reference/features/output-safety.md) for ownership and recovery rules.

## `skillset dev` keeps running or does not write

`dev` is a foreground watch process and is preview-only by default. Stop it with the normal terminal interrupt. Use `dev --write` only when continuous managed writes are intended.

The watcher observes workspace configuration and source—not generated output, caches, locks, or backups. Edit `.skillset/` to trigger the normal loop. See [Dev Watch](reference/features/dev-watch.md).

## Generated files exist but the provider cannot see them

A successful build proves repository output, not runtime [activation](glossary.md#activation). Skillset renders files. It does not install, trust, activate, symlink, or mutate user-level provider configuration. See [Build Versus Activation](start/build-versus-activation.md), then use the provider's own review and enablement workflow.

## CI and local checks disagree

Run the same aggregate locally with `bunx skillset check --ci` and inspect its Git baseline, report, runtime version, and generated diff. Regenerate only after reviewing the plan; do not start with `--fix` when the cause is unknown.

The [CI feature reference](reference/features/ci.md) owns the current check and workflow contract.

## Marketplace check or update refuses an entry

Start with `bunx skillset marketplace check <name> --json`. Resolve the first reported repository, revision, target, generated-output, or lock-provenance failure before previewing an update. A check may contact an external Git remote and refresh Skillset's owned XDG cache, but it does not repair repository output.

Use the [marketplace guide](guides/marketplaces.md) for the workflow and the [marketplace feature reference](reference/features/marketplaces.md) for readiness and refusal states.

## A test, eval, or runtime probe fails

Separate deterministic projection failures from provider infrastructure or ungraded trial results. Preserve the retained run ID and report, then inspect `skillset test status`, `skillset test tail`, `skillset eval status`, or `skillset eval tail` for the surface that failed. Missing binaries, authentication, timeout, cancellation, and malformed provider output cannot establish runtime proof.

See [Tests and Evals](reference/features/tests-and-evals.md) for the execution contracts and [Runtime Activation Readiness](reference/features/runtime-activation-readiness.md) for observational evidence and claim ceilings.

## Version audit reports a mismatch

Identify whether the reported locus is missing, malformed, or stale before changing a version. Source and release history remain authoritative; do not edit a generated manifest merely to satisfy the audit. Re-run the release audit and normal check after repairing the owning source or confirmed release projection.

See [Version Audit](reference/features/version-audit.md), [Releases and Changelogs](reference/features/releases.md), and [Publishing](guides/publishing.md).

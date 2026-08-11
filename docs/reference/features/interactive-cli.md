---
description: Skillset's interactive CLI defines when prompts appear, how they inherit command safety, and how automation avoids them.
---

# Interactive CLI

Cross-command workflow reference; no registry feature id.

Skillset uses prompts only to complete missing human intent. The underlying planner, registry, or operation remains authoritative for available choices, validation, diagnostics, and writes.

## When Skillset Prompts

Prompts require TTY stdin and stdout, a non-CI environment, and human-readable output. An explicitly supplied value skips only its matching picker; it does not bypass a write confirmation.

Mutation routes show their ordinary plan or readiness report before a shared `Proceed?` confirmation. The default is No. Declining or cancelling leaves source, [generated output](../../glossary.md#generated-output), provider indexes, and locks unchanged. Ctrl-C exits with status 130.

## Avoid Prompts in Automation

- Supply every required argument rather than relying on a picker.
- Use `--yes` only after the plan is fully specified and the mutation is intended.
- Request JSON or JSONL where the command supports machine output.
- Run through non-TTY stdin/stdout in CI or pipelines.

JSON, JSONL, raw protocol execution, pipes, non-TTY processes, CI, and explicit `--yes` writes never prompt. Missing required input in those modes fails with a diagnostic rather than guessing.

Shared behavior such as `--root`, `--json`, and `--yes` is defined in [CLI flag conventions](../cli-flags.md).

## Route Ownership

| Route | Prompted choice | Contract owner |
| --- | --- | --- |
| [`init`](../cli/init.md) | Adoption intent, targets, automation | Setup survey and initialization plan |
| [`create`](../cli/create.md) | Name, parent, targets, automation | Setup plan |
| [`new`](../cli/new.md) | Source kind, identity, placement, preset or hook intent | Source planners and canonical registries |
| [`test`](../cli/test.md) | Declaration or ad hoc runtime input | Test inventory and retained runner |
| [`lookup`](../cli/lookup.md) | Subject, view, target lens, field | Lookup APIs and ordinary report |
| [`reconcile`](../cli/reconcile.md) | Managed path and approved direction | Reconcile preview and write operation |
| [`marketplace update`](../cli/marketplace.md) | Catalog when ambiguous | Marketplace readiness and atomic update plan |

Prompt descriptions and disabled reasons remain visible at narrow terminal widths. Searchable lists preserve filtering, keyboard navigation, disabled rows, and cancellation; those controls do not create a second command contract.

## Failure and Safety Cases

| Situation | Result |
| --- | --- |
| Required input is missing outside a TTY | Non-zero diagnostic; no prompt and no write |
| User declines confirmation | Successful cancellation with no mutation |
| User presses Ctrl-C | Exit 130 with no mutation |
| A choice becomes stale before apply | The owning operation revalidates and refuses the stale plan |
| A disabled choice is selected | The prompt shows the owner-provided reason and blocks selection |

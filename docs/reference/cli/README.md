---
description: Lists Skillset's public CLI commands, shared exit classes, and links to contract-generated command reference.
---

# CLI Reference

These pages are generated from the same typed presentation and flag contracts used by `skillset --help`. Edit those contracts when command behavior changes, then run `bun run docs:generate`.

<!-- skillset:generated:start cli-command-list -->
## Author

- [`skillset create`](./create.md) — Create a named Skillset repository.
- [`skillset draft`](./draft.md) — Preview and atomically fork a shipped skill into its draft sibling.
- [`skillset import`](./import.md) — Import provider-native or Agent standards skills and plugins into source.
- [`skillset init`](./init.md) — Initialize Skillset in an existing directory.
- [`skillset move`](./move.md) — Preview and atomically move a skill between workspace and plugin collections.
- [`skillset new`](./new.md) — Create a new plugin, skill, project agent, instruction, or hook in source.
- [`skillset promote`](./promote.md) — Preview and atomically promote a draft skill to its shipped sibling.
- [`skillset rename`](./rename.md) — Preview and atomically rename an authored source path.

## Build

- [`skillset build`](./build.md) — Preview or write generated provider outputs.
- [`skillset check`](./check.md) — Validate source, generated outputs, and CI readiness.
- [`skillset dev`](./dev.md) — Watch source and continuously preview or write changes.
- [`skillset diff`](./diff.md) — Show the generated-output plan without writing it.
- [`skillset update`](./update.md) — Update provider-format snapshots and generated outputs.

## Inspect

- [`skillset eval`](./eval.md) — List portable skill eval cases and their resolved target matrix.
- [`skillset explain`](./explain.md) — Explain ownership and provenance for a path.
- [`skillset list`](./list.md) — List authored units and their generated outputs.
- [`skillset lookup`](./lookup.md) — Look up schema, compatibility, and provider facts.
- [`skillset report`](./report.md) — Inspect immutable operational reports.
- [`skillset status`](./status.md) — Summarize workspace health and generated drift.
- [`skillset test`](./test.md) — Run declared or ad hoc provider runtime tests.

## Changes

- [`skillset change`](./change.md) — Record and inspect source changes before release.
- [`skillset release`](./release.md) — Audit, plan, apply, and amend releases.
- [`skillset reconcile`](./reconcile.md) — Reconcile a managed source/output conflict.
- [`skillset resolve`](./resolve.md) — Repair and stage generated-output conflicts during a rebase or merge.
- [`skillset restore`](./restore.md) — Restore a recorded generated-output backup.

## Distribute

- [`skillset distribute`](./distribute.md) — Plan distribution-ready plugin artifacts.
- [`skillset marketplace`](./marketplace.md) — Check and update curated plugin marketplaces.

## Integrate

- [`skillset hooks`](./hooks.md) — Print and run explicit hook integrations.
<!-- skillset:generated:end cli-command-list -->

For shared argument behavior, see [CLI flag conventions](../cli-flags.md).

## Exit classes

Human, `--json`, and `--jsonl` modes use the same exit class for the same
result. The shared classifier never infers a code from a message prefix.

| Class | Code | Meaning |
| --- | ---: | --- |
| success | `0` | The command completed as requested. |
| failure | `1` | Validation, data, or unexpected failure. |
| usage | `2` | The invocation itself is invalid: unknown option, missing required argument, conflicting flags, or a malformed argument value. |

A malformed argument value is a usage error (`2`); a well-formed value that
does not resolve is a failure (`1`). For example, `change show @zz` exits `2`
because `@zz` is not a hex ref, while a well-formed ref that matches no entry
exits `1`. Values that core validates are current exceptions and exit `1`:
`restore` backup ids and the slug names that core checks for `import --name`
and `create`. Aligning them is tracked as a follow-up.

Codes `3` and `4` are command-specific and appear only when a command sets them
explicitly in its result or through `CliOutputError`. The report command uses
`3` for an unreadable owned bundle. Report and structured-output invariant
failures use `4`.
Interactive prompt cancellation uses `130`.

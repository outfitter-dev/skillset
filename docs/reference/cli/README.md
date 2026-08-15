---
description: Lists Skillset's public CLI commands and links to contract-generated command reference.
---

# CLI Reference

These pages are generated from the same typed presentation and flag contracts used by `skillset --help`. Edit those contracts when command behavior changes, then run `bun run docs:generate`.

<!-- skillset:generated:start cli-command-list -->
## Author

- [`skillset create`](./create.md) — Create a named Skillset repository.
- [`skillset import`](./import.md) — Import provider-native skills or plugins into source.
- [`skillset init`](./init.md) — Initialize Skillset in an existing directory.
- [`skillset new`](./new.md) — Create a new skill, agent, instruction, or hook in source.
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
- [`skillset restore`](./restore.md) — Restore a recorded generated-output backup.

## Distribute

- [`skillset distribute`](./distribute.md) — Plan distribution-ready plugin artifacts.
- [`skillset marketplace`](./marketplace.md) — Check and update curated plugin marketplaces.

## Integrate

- [`skillset hooks`](./hooks.md) — Print and run explicit hook integrations.
<!-- skillset:generated:end cli-command-list -->

For shared argument behavior, see [CLI flag conventions](../cli-flags.md).

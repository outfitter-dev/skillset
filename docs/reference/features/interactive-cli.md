# Interactive CLI

Skillset uses interactive prompts only as a terminal adapter for incomplete
human intent. Reports, registries, planners, and operations remain the source of
truth for choices, readiness, safety, diagnostics, and writes.

## Eligibility

Prompts require TTY stdin and stdout, a non-CI environment, and a human-output
route. JSON, JSONL, raw protocol execution, pipes, non-TTY processes, and
explicit `--yes` writes never prompt. Ctrl-C is normalized to exit 130.

Mutation routes render their ordinary plan or readiness report before the
shared `Proceed?` confirmation, whose default is No. Decline and cancellation
must not change source, generated output, provider indexes, or locks.

## Route ownership

| Route | Prompt input | Authoritative owner |
| --- | --- | --- |
| `init` | adoption intent, targets, automation | existing setup survey and plan |
| `create` | name, parent, targets, automation | existing setup plan |
| `new` | source kind, identity, placement, preset or hook intent | source planners and canonical registries |
| `test` | declared/ad hoc selection and missing runtime input | declared-test inventory and retained test runner |
| `lookup` | missing subject, view, target lens, and field | lookup subject/view/field APIs and ordinary report |
| `reconcile` | missing path and report-approved direction | reconcile preview, backup, rollback, and write operation |
| `marketplace update` | configured catalog when ambiguous | marketplace readiness/update report and atomic Core transaction |

An explicit value skips only its matching picker. It does not bypass a required
mutation confirmation unless `--yes` is also present.

## Terminal behavior

Prompt rendering uses the active output width and keeps descriptions and
disabled reasons visible. Searchable controls preserve filtering, keyboard
navigation, disabled rows, and controlled cancellation. Large or schema-backed
choice sets use the existing search adapters; small finite decisions use
select or checkbox controls.

The controlled terminal suite covers normal and narrow widths, search and
no-result behavior, disabled explanations, default-No, Ctrl-C 130, machine
exclusion, byte-identical declined/cancelled mutations, confirmed writes, and
post-write checks in disposable workspaces.

## Verification

Run the complete interaction and terminal surface with:

```bash
bun run test:focused -- apps/skillset/src/__tests__/*interactive.test.ts
bun run test:focused -- apps/skillset/src/__tests__/*pty.test.ts
bun run test:focused -- apps/skillset/src/__tests__/interactive-session.test.ts
bun run test:focused -- apps/skillset/src/__tests__/interactive-surface-inventory.test.ts
```

The prompt-surface inventory keeps every command owner explicit and proves
that each retained prompt-adapter primitive has a production caller.

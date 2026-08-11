---
description: Hook guardrails define how maintainers change, verify, and troubleshoot Git and agent-runtime integrations.
---

# Hook Guardrails

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `runtime-context` | `implemented` | `transformed` | `transformed` | `transformed` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](../../reference/features/README.md#support-vocabulary)

Hook guardrails connect repository and agent-runtime events to existing Skillset checks. They print reviewed configuration snippets and dispatch two runtime events; they do not install hooks or create [source truth](../../glossary.md#canonical-source). Portable and [provider-native](../../glossary.md#provider-native) plugin hooks have a separate [feature contract](../../reference/features/hooks.md).

## Ownership and Inputs

`apps/skillset/src/runtime-hooks/print.ts` owns deterministic Git-runner and agent-runtime snippets. `run.ts` owns dispatch, `source-gate.ts` owns the repository change gate, `context.ts` normalizes provider input, and `commands.ts` resolves and executes Skillset. The public route and flags are owned by the CLI registry and [projected](../../glossary.md#projection) into the [`hooks` reference](../../reference/cli/hooks.md).

The print command accepts either a Git runner or an agent-runtime [target](../../glossary.md#target):

```bash
skillset hooks print --runner lefthook --pre-commit --pre-push
skillset hooks print --runner git --pre-commit --pre-push
skillset hooks print --target claude --agent-runtime
skillset hooks print --target codex --agent-runtime
```

Runner snippets call `skillset change check --staged` at pre-commit and `skillset change check --since origin/main && skillset check` at pre-push. Agent-runtime snippets target reviewed project-local Claude or Codex configuration. Cursor has no documented runtime-hook [destination](../../glossary.md#destination) for this surface and is rejected by the print command.

## Outputs and Runtime Behavior

| Input | Output or action | Boundary |
| --- | --- | --- |
| Git runner | Additive text for lefthook, Husky, pre-commit, or plain Git hooks | Caller reviews and installs it. |
| Claude or Codex agent runtime | JSON suggestion plus destination comment | Caller reviews and merges it into project-local runtime config. |
| `post-tool-use` | Runs `skillset change status --root .` after relevant source changes | Advisory; command failure does not block the agent event. |
| `stop` | Runs `skillset change check --root .`, then `skillset check --root .` | Blocking; stops after the first failure. |
| Toolkit runtime context | Normalized `provider`, `hook.event`, and `session.id` fields | Provider input is permissively normalized at the boundary. |

Both runtime events first inspect `skillset.yaml`, `.skillset/`, and the retired root `skillset/` migration marker, including untracked files. No relevant change produces a successful no-op. A source-gate failure blocks `stop` but remains non-blocking for `post-tool-use`.

Nested commands strip repository-targeting `GIT_*` variables so inherited hook-runner state cannot redirect the check. Resolution tries the local compiler checkout and installed package runners; `SKILLSET_HOOK_COMMAND` is the explicit reviewed override.

## Changing or Regenerating Guardrails

When a command, path gate, destination, or event changes:

1. Change the owning runtime-hook module, not copied example text.
2. Update CLI presentation and argument contracts if public grammar changes.
3. Update exact snippet and dispatch tests for every affected runner or target.
4. Regenerate CLI reference and verify the authored hook feature page still owns provider behavior.

```bash
bun run docs:generate
bun run docs:check
bun run test:focused -- apps/skillset/src/__tests__/runtime-hooks.test.ts apps/skillset/src/__tests__/cli-args.test.ts
```

## Troubleshooting

- An empty runtime invocation usually means the source gate found no relevant change; inspect its tracked and untracked path coverage before changing dispatch.
- A `stop` event that cannot inspect Git state must fail closed. A `post-tool-use` event with the same inspection failure remains advisory by design.
- A snippet mismatch belongs to `print.ts` or CLI presentation, not generated documentation.
- A provider context mismatch belongs to the shared toolkit normalizer or runtime input adapter. Do not make source-change safety depend on successful provider detection.
- A missing executable should be repaired through the command-resolution chain or an explicit `SKILLSET_HOOK_COMMAND`, not by embedding a repository-specific command in generated snippets.

## Provenance

Guardrails call commands that derive diagnostics from [canonical source](../../glossary.md#canonical-source), change entries, locks, and [release state](../../reference/features/releases.md). The runtime result records the event, normalized context, source-gate outcome, commands run, and exit code; it does not become another source contract.

## Evidence and Decisions

- `apps/skillset/src/runtime-hooks/{print,run,source-gate,context,commands}.ts` owns the implementation boundary.
- `apps/skillset/src/__tests__/runtime-hooks.test.ts` proves snippet, gate, dispatch, resolution, and environment behavior.
- `packages/toolkit/src/runtime.ts` and its tests own cross-provider runtime-context normalization.
- [Source Change, Release, and Dependency Provenance](../../adrs/0014-source-change-release-provenance.md) defines the provenance guardrail.
- [Reviewed Settings Suggestions](../../adrs/drafts/20260604-reviewed-settings-suggestions.md) records why runtime configuration remains reviewed and opt-in.

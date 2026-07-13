# Hook Guardrails

Feature id: `hook-guardrails`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Hook guardrails help humans and agents notice missing change reasons, stale generated output, or release provenance drift. They are workflow snippets, not target plugin hook definitions. For target plugin hooks, see [Hooks](hooks.md).

## Authoring

V1 is print/snippet-first for installation and first-class for runtime execution. Skillset generates snippets for existing hook runners such as lefthook, Husky, pre-commit, or plain Git fallback hooks, and exposes `skillset hooks run` commands for reviewed provider runtime configs to call. It should not take over `.git/hooks`, overwrite hook-manager config, or mutate user-level provider runtime config during build/check/diff/import/init/create.

Examples:

```bash
skillset hooks print --runner lefthook --pre-commit --pre-push
skillset hooks print --runner husky --pre-commit --pre-push
skillset hooks print --runner pre-commit --pre-commit --pre-push
skillset hooks print --runner git --pre-commit --pre-push
skillset hooks print --target claude --agent-runtime
skillset hooks print --target codex --agent-runtime
skillset hooks run post-tool-use
skillset hooks run stop
skillset-toolkit runtime context --event Stop --format env --fields provider,hook.event,session.id
```

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Git hook-runner snippet | n/a | n/a | `implemented` | Prints additive snippets for existing hook runners; does not install. |
| Agent runtime hook suggestion | reviewed config suggestion | reviewed config suggestion | `implemented` / `target_specific` | Prints project-local suggestions; must not mutate runtime config automatically. |
| Agent runtime hook execution | `skillset hooks run post-tool-use`, `skillset hooks run stop` | `skillset hooks run post-tool-use`, `skillset hooks run stop` | `implemented` / `target_specific` | Core CLI behavior called by reviewed project-local runtime config. |
| Runtime context helper | `skillset-toolkit runtime context --event <event> --format env|json` | `skillset-toolkit runtime context --event <event> --format env|json` | `implemented` / `target_specific` | Helper used by generated adaptive hook wrappers for `context.strategy: toolkit`; the shared context model lives in `@skillset/toolkit/runtime`. |

For the normalized runtime context support matrix, use `skillset lookup hooks toolkit --field context.env --values --compat claude,codex` or see [Hooks](hooks.md#runtime-context).

## Diagnostics

Pre-commit guardrails are staged-aware and fast through `skillset change check --staged`, which compares the Git index against `HEAD`. Pre-push snippets run broader checks through `skillset change check --since origin/main`, `skillset check`, `skillset check --only outputs`, and `skillset status`.

Runtime hook execution stays narrower than Git hooks. `skillset hooks run post-tool-use` and `skillset hooks run stop` first inspect the Skillset source/change-entry paths that can affect source provenance, including untracked files:

- `skillset.yaml`
- `.skillset/changes`
- `.skillset`

The runtime gate also watches the retired root `skillset/` marker so in-flight migration branches do not bypass checks while the resolver reports the required cutover.

`PostToolUse` is advisory: after write/edit tools it runs `skillset change status --root .` only when one of those paths has a tracked or untracked change, and it does not block the agent turn. `Stop` is blocking but uses the same path gate before running `skillset change check --root .` and the comprehensive `skillset check --root .`. `Stop` deliberately does not run the broader `status` view; explicit bootstrap diagnostics and pre-push snippets remain the broader guardrail. Runtime suggestions remain opt-in reviewed configuration, and the public snippets call the installable `skillset hooks run ...` commands.

Runtime hook execution resolves the Skillset command from the local compiler checkout, an installed `skillset`, `bunx skillset`, `bun x skillset`, or `npx --yes skillset`. Reviewed runtime configs may set `SKILLSET_HOOK_COMMAND` when a project needs an explicit command override. Hook subprocesses strip repository-targeting `GIT_*` variables before invoking nested Skillset commands so runtime checks inspect the configured root rather than the hook runner's inherited Git context.

## Provenance

Hook guardrails do not create source truth. They call Skillset commands that produce diagnostics from source entries, locks, and release state. Runtime context parsing is permissive: Claude-like env, Codex-like env, unknown env, and optional JSON stdin payloads are normalized at the boundary without making source-change safety depend on provider detection.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md) and [Reviewed Settings Suggestions](../adrs/drafts/20260604-reviewed-settings-suggestions.md).

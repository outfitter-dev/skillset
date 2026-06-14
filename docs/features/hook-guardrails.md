# Hook Guardrails

Feature id: `hook-guardrails`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Hook guardrails help humans and agents notice missing change reasons, stale generated output, or release provenance drift. They are workflow snippets, not target plugin hook definitions. For target plugin hooks, see [Hooks](hooks.md).

## Authoring

V1 is print/snippet-first for installation and first-class for runtime execution. Skillset generates snippets for existing hook runners such as lefthook, Husky, pre-commit, or plain Git fallback hooks, and exposes `skillset hooks run` commands for reviewed Claude/Codex runtime configs to call. It should not take over `.git/hooks`, overwrite hook-manager config, or mutate user-level Claude/Codex runtime config during build/check/diff/import/init/create.

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
```

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Git hook-runner snippet | n/a | n/a | `implemented` | Prints additive snippets for existing hook runners; does not install. |
| Agent runtime hook suggestion | reviewed config suggestion | reviewed config suggestion | `implemented` / `target_specific` | Prints project-local suggestions; must not mutate runtime config automatically. |
| Agent runtime hook execution | `skillset hooks run post-tool-use`, `skillset hooks run stop` | `skillset hooks run post-tool-use`, `skillset hooks run stop` | `implemented` / `target_specific` | Core CLI behavior called by reviewed project-local runtime config. |

## Diagnostics

Pre-commit guardrails are staged-aware and fast through `skillset change check --staged`, which compares the Git index against `HEAD`. Pre-push snippets run broader checks through `skillset change check --since origin/main`, `skillset check`, and `skillset doctor`.

Runtime hook execution stays narrower than Git hooks. `skillset hooks run post-tool-use` and `skillset hooks run stop` first inspect the Skillset source/change-entry paths that can affect source provenance, including untracked files:

- `.skillset/config.yaml`
- `.skillset/instructions`
- `.skillset/skills`
- `.skillset/plugins`
- `.skillset/shared`
- `.skillset/src`
- `.skillset/changes/pending`

`PostToolUse` is advisory: after write/edit tools it runs `skillset change status --root .` only when one of those paths has a tracked or untracked change, and it does not block the agent turn. `Stop` is blocking but uses the same path gate before running `skillset change check --root .` and `skillset check --root .`. `Stop` deliberately does not run `doctor`; explicit bootstrap diagnostics and pre-push snippets remain the broader guardrail. Runtime suggestions remain opt-in reviewed configuration, and the public snippets call the installable `skillset hooks run ...` commands.

Runtime hook execution resolves the Skillset command from the local compiler checkout, an installed `skillset`, `bunx skillset@beta`, `bun x skillset@beta`, or `npx --yes skillset@beta`. Reviewed runtime configs may set `SKILLSET_HOOK_COMMAND` when a project needs an explicit command override. Hook subprocesses strip repository-targeting `GIT_*` variables before invoking nested Skillset commands so runtime checks inspect the configured root rather than the hook runner's inherited Git context.

## Provenance

Hook guardrails do not create source truth. They call Skillset commands that produce diagnostics from source entries, locks, and release state. Runtime context parsing is permissive: Claude-like env, Codex-like env, unknown env, and optional JSON stdin payloads are normalized at the boundary without making source-change safety depend on provider detection.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md) and [Reviewed Settings Suggestions](../adrs/drafts/20260604-reviewed-settings-suggestions.md).

# Hook Guardrails

Feature id: `hook-guardrails`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Hook guardrails help humans and agents notice missing change reasons, stale generated output, or release provenance drift. They are workflow snippets, not target plugin hook definitions. For target plugin hooks, see [Hooks](hooks.md).

## Authoring

V1 is print/snippet-first. Skillset should generate snippets for existing hook runners such as lefthook, Husky, pre-commit, or plain Git fallback hooks. It should not take over `.git/hooks`, overwrite hook-manager config, or mutate user-level Claude/Codex runtime config during build/check/diff/import/init/create.

Examples:

```bash
skillset hooks print --runner lefthook --pre-commit --pre-push
skillset hooks print --runner husky --pre-commit --pre-push
skillset hooks print --runner pre-commit --pre-commit --pre-push
skillset hooks print --runner git --pre-commit --pre-push
skillset hooks print --target claude --agent-runtime
skillset hooks print --target codex --agent-runtime
```

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Git hook-runner snippet | n/a | n/a | `implemented` | Prints additive snippets for existing hook runners; does not install. |
| Agent runtime hook suggestion | reviewed config suggestion | reviewed config suggestion | `implemented` / `target_specific` | Prints project-local suggestions; must not mutate runtime config automatically. |

## Diagnostics

Pre-commit guardrails are staged-aware and fast through `skillset change check --staged`, which compares the Git index against `HEAD`. Pre-push snippets run broader checks through `skillset change check --since origin/main`, `skillset check`, and `skillset doctor`. Runtime hook suggestions nudge agents after `.skillset/**` edits and run a Stop guardrail before the agent finishes, but they remain opt-in reviewed configuration.

## Provenance

Hook guardrails do not create source truth. They call Skillset commands that produce diagnostics from source entries, locks, and release state.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md) and [Reviewed Settings Suggestions](../adrs/drafts/20260604-reviewed-settings-suggestions.md).

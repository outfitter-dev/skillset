# Hook Guardrails

Feature id: `hook-guardrails`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Hook guardrails help humans and agents notice missing change reasons, stale generated output, or release provenance drift. They are workflow snippets, not target plugin hook definitions. For target plugin hooks, see [Hooks](hooks.md).

## Authoring

V1 is print/snippet-first. Skillset should generate snippets for existing hook runners such as lefthook, Husky, pre-commit, or plain Git fallback hooks. It should not take over `.git/hooks`, overwrite hook-manager config, or mutate user-level Claude/Codex runtime config during build/check/diff/import/init/create.

Example future commands:

```bash
skillset hooks print --runner lefthook --pre-commit --pre-push
skillset hooks print --runner husky --pre-commit --pre-push
skillset hooks print --runner pre-commit --pre-commit --pre-push
skillset hooks print --runner git --pre-commit --pre-push
```

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Git hook-runner snippet | n/a | n/a | `planned` | Prints commands for existing hook runners. |
| Agent runtime hook suggestion | reviewed config suggestion | reviewed config suggestion | `future` | Must not mutate runtime config automatically. |

## Diagnostics

Pre-commit guardrails should be staged-aware and fast, such as `skillset change check --staged`. Pre-push guardrails can run broader status, generated-output check, and release-plan consistency checks. Runtime hook suggestions can nudge agents after `.skillset/**` edits, but they remain opt-in.

## Provenance

Hook guardrails do not create source truth. They call Skillset commands that produce diagnostics from source entries, locks, and release state.

## Evidence

See [Source Change, Release, and Dependency Provenance](../adrs/drafts/20260609-source-change-release-provenance.md) and [Reviewed Settings Suggestions](../adrs/drafts/20260604-reviewed-settings-suggestions.md).

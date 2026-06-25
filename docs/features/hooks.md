# Hooks

Feature id: `hooks`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Hooks are rendered definitions only. Skillset never installs, trusts, enables, or mutates user-level Claude or Codex configuration as a side effect of build, check, diff, import, init, or create.

For the planned portable source model above native aggregate pass-through, see [Adaptive Hooks](adaptive-hooks.md).

## Authoring

The canonical plugin hook source is `<source-root>/plugins/<plugin>/hooks/hooks.json`. `<source-root>` is `.skillset/src/` in ordinary repos and `skillset/` in dedicated Skillset repos. Plugin-root `hooks.json` is rejected; put hook definitions under `hooks/hooks.json`.

Hook source is JSON with an aggregate `hooks` event map. Event entries may include a `matcher`, `statusMessage`, and a `hooks` array whose handlers declare a non-empty `type` plus handler-specific fields such as `command`, `prompt`, `agent`, `timeout`, and `async`. The active source contract is generated from `@skillset/schema`; see [schema reference](../reference/schemas/README.md) and [hook examples](../reference/examples/hook.yaml) for the current field set.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `hooks/hooks.json` | `hooks/hooks.json` | `hooks/hooks.json` | `target_native` / `implemented` | Rendered with a top-level `hooks` object. |
| root `hooks.json` | n/a | n/a | `unsupported` | Move the file to `hooks/hooks.json`. |
| Future `hooks.source` | n/a | n/a | `planned` | No feature-key source pointer exists in v1. |

## Diagnostics

- Reject plugin-root `hooks.json` and hook files that are not JSON objects.
- Validate hook file shape with the shared `@skillset/schema` contract used by Workbench and schema artifacts.
- Keep Claude validation broad because Claude's hook surface is wider and still evolving.
- Validate Codex hooks against supported events and synchronous `command` handlers.
- Reject Codex prompt handlers, agent handlers, async command handlers, missing handler types, and unsupported events because Codex parses but skips them.

## Provenance

Hook definitions are generated plugin files. Plugin lock hashes include hook source content through plugin output hashes; hooks are not activation state.

## Tests and Fixtures

Fixtures cover shared hooks, root hook rejection, target-specific hook validation, async handler rejection, excluded plugin output selection, and generated manifest fields.

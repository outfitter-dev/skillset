# Hooks

Feature id: `hooks`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Hooks are rendered definitions only. Skillset never installs, trusts, enables, or mutates user-level Claude or Codex configuration as a side effect of build, check, diff, import, init, or create.

## Authoring

The canonical plugin hook source is `.skillset/plugins/<plugin>/hooks/hooks.json`. Plugin-root `hooks.json` is rejected; put hook definitions under `hooks/hooks.json`.

## Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `hooks/hooks.json` | `hooks/hooks.json` | `hooks/hooks.json` | `target_native` / `implemented` | Rendered with a top-level `hooks` object. |
| root `hooks.json` | n/a | n/a | `unsupported` | Move the file to `hooks/hooks.json`. |
| Future `hooks.source` | n/a | n/a | `planned` | No feature-key source pointer exists in v1. |

## Diagnostics

- Reject plugin-root `hooks.json` and hook files that are not JSON objects.
- Keep Claude validation broad because Claude's hook surface is wider and still evolving.
- Validate Codex hooks against supported events and synchronous `command` handlers.
- Reject Codex prompt handlers, agent handlers, async command handlers, missing handler types, and unsupported events because Codex parses but skips them.

## Provenance

Hook definitions are generated plugin files. Plugin lock hashes include hook source content through plugin output hashes; hooks are not activation state.

## Tests and Fixtures

Fixtures cover shared hooks, root hook rejection, target-specific hook validation, async handler rejection, excluded plugin output selection, and generated manifest fields.

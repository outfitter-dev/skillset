# Hooks

Feature id: `hooks`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Hooks are emitted definitions only. Skillset never installs, trusts, enables, or mutates user-level Claude or Codex configuration as a side effect of build, check, diff, import, init, or create.

## Authoring

The canonical plugin hook source is `.skillset/plugins/<plugin>/hooks/hooks.json`. A plugin-root `hooks.json` remains a Codex compatibility source that warns and normalizes to `hooks/hooks.json`. When both files exist, the canonical path is shared for Claude while the root compatibility file can intentionally carry Codex-specific migration content.

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `hooks/hooks.json` | `hooks/hooks.json` | `hooks/hooks.json` | `target_native` / `implemented` | Emitted with a top-level `hooks` object. |
| root `hooks.json` | n/a | `hooks/hooks.json` | `compat_alias` / `implemented` | Warned; flat event maps are normalized. |
| Future `hooks.source` | n/a | n/a | `planned` | No feature-key source pointer exists in v1. |

## Diagnostics

- Reject hook files that are not JSON objects.
- Keep Claude validation broad because Claude's hook surface is wider and still evolving.
- Validate Codex hooks against supported events and synchronous `command` handlers.
- Reject Codex prompt handlers, agent handlers, async command handlers, missing handler types, and unsupported events because Codex parses but skips them.

## Provenance

Hook definitions are generated plugin files. Plugin lock hashes include hook source content through plugin output hashes; hooks are not activation state.

## Tests and Fixtures

Fixtures cover shared hooks, Codex root compatibility warnings, target-specific hook validation, async handler rejection, excluded plugin output selection, and generated manifest fields.

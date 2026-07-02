# Hooks

Feature id: `hooks`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Hooks are rendered definitions only. Skillset never installs, trusts, enables, or mutates user-level Claude or Codex configuration as a side effect of build, check, diff, import, init, or create.

Skillset supports two hook source styles:

- Native aggregate hooks: provider-shaped plugin hook files at `hooks/hooks.json`.
- Adaptive hook units: reusable hook definitions under `hooks/<name>.json` or `hooks/<name>/hook.json` that attach to plugins, skills, or project agents and render only where Skillset can preserve the intended scope.

## Native Aggregate Hooks

The canonical plugin hook source is `<source-root>/plugins/<plugin>/hooks/hooks.json`. `<source-root>` is `.skillset/`. Plugin-root `hooks.json` is rejected; put hook definitions under `hooks/hooks.json`.

Hook source is JSON with an aggregate `hooks` event map. Event entries may include a `matcher`, `statusMessage`, and a `hooks` array whose handlers declare a non-empty `type` plus handler-specific fields such as `command`, `prompt`, `agent`, `timeout`, and `async`. The active source contract is generated from `@skillset/schema`; see [schema reference](../reference/schemas/README.md) and [hook examples](../reference/examples/hook.yaml) for the current field set.

Use native aggregate source when the hook file is already provider-shaped or intentionally provider-specific. Use adaptive hook units when the hook behavior should attach to a plugin, skill, or project agent and Skillset should render only destinations that preserve that scope.

`hooks/hooks.json` is a destination-specific native aggregate source. It is not a universal sink for portable hook behavior, and it cannot be combined with adaptive hook units for the same generated plugin hook destination.

Imported provider-native hook files stay native by default. Skillset should only lift native hook material into adaptive hook units when provider capability facts prove the event, matcher, handler, scope, and runtime behavior can be preserved faithfully. Otherwise, native source remains the honest representation.

### Target Rendering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| `hooks/hooks.json` | `hooks/hooks.json` | `hooks/hooks.json` | `target_native` / `implemented` | Destination-specific native aggregate source rendered with a top-level `hooks` object. |
| root `hooks.json` | n/a | n/a | `unsupported` | Move the file to `hooks/hooks.json`. |
| Future `hooks.source` | n/a | n/a | `planned` | No feature-key source pointer exists in v1. |

## Adaptive Hook Units

Feature id: `adaptive-hooks`

Adaptive hook units are Skillset-authored source. They let authors define hook behavior once, attach it to the source unit where it belongs, and have Skillset render only provider/destination combinations that preserve the intended scope and runtime behavior.

Adaptive hooks are separate from workflow hook guardrails. Guardrails such as `skillset hooks print` and `skillset hooks run stop` help local Git hooks or reviewed agent-runtime snippets call Skillset checks. Adaptive hooks compile source-authored runtime hook definitions into provider-native hook surfaces.

### Source Model

| Source | Meaning |
| --- | --- |
| `hooks/<name>.json` | Flat adaptive hook unit. |
| `hooks/<name>/hook.json` | Directory adaptive hook unit with hook-local sidecars. |
| `hooks/<name>/<name>.json` | Directory adaptive hook unit with a manifest named after the directory. |
| `hooks/hooks.json` | Reserved native aggregate escape hatch, not an adaptive hook unit. |

Directory hook units must resolve to the directory name. If both `hook.json` and `<name>.json` exist in the same hook directory, Skillset fails with an ambiguous manifest diagnostic.

Native aggregate mode and adaptive mode do not merge for the same generated destination. If `hooks/hooks.json` and adaptive hook units would both write a provider plugin `hooks/hooks.json`, Skillset fails and asks the author to choose one source model.

### Scripts

Adaptive hook `run.script` references have two source-backed forms:

| Reference | Source proof |
| --- | --- |
| `./check.js` | Hook-local script beside a directory hook unit such as `hooks/<name>/hook.json` or `hooks/<name>/<name>.json`. |
| `{{scripts.dir}}/check.js` | Shared script under the owner source directory's `scripts/` folder. Root hooks use `<source-root>/scripts/`; plugin hooks use `<plugin>/scripts/`; skill-local hooks use the skill directory's `scripts/`; project-agent-local hooks use the sibling agent directory's `scripts/`. |

Flat hook units such as `hooks/<name>.json` cannot use `./...` hook-local scripts because they do not own a private sidecar directory. Use a directory hook unit for colocated sidecars or `{{scripts.dir}}/...` for owner-level shared scripts.

Plugin-level adaptive hook rendering copies referenced scripts into the generated plugin root and rewrites commands to provider runtime roots: `$CLAUDE_PLUGIN_ROOT` for Claude plugin hooks and `$PLUGIN_ROOT` for Codex plugin hooks.

### Runtime Context

Adaptive hook units can choose how much Skillset-normalized runtime context to pass to their command:

```json
{
  "events": ["Stop"],
  "context": {
    "strategy": "inline",
    "env": ["provider", "hook.event", "session.id"]
  },
  "run": {
    "command": "node ./session-summary.js"
  }
}
```

`context.strategy` supports:

| Strategy | Behavior |
| --- | --- |
| `inline` | Prefixes the generated command with requested `SKILLSET_*` environment assignments. |
| `none` | Passes no Skillset-normalized context. Provider-native environment remains available. |
| `toolkit` | Renders through the `skillset-toolkit runtime context` helper shipped with the `skillset` package, backed by the shared `@skillset/toolkit/runtime` context model. |

Inline v1 fields are deliberately small:

| Field | Generated variable |
| --- | --- |
| `provider` | `SKILLSET_PROVIDER` (`claude` or `codex`) |
| `hook.event` | `SKILLSET_HOOK_EVENT` |
| `session.id` | `SKILLSET_SESSION_ID`, sourced from `${CLAUDE_SESSION_ID:-}` or `${CODEX_SESSION_ID:-}` |

Omitting `context` is equivalent to `context.strategy: none`, so existing hooks keep their command text unchanged.

For `context.strategy: toolkit`, generated hooks call the installable helper:

```sh
skillset-toolkit runtime context --event <event> --format env --fields <field,...>
```

The helper prints shell `export` statements for the requested `SKILLSET_*` values and preserves provider-native environment access for the hook command. It does not erase target-native variables such as `CLAUDE_SESSION_ID` or `CODEX_SESSION_ID`; scripts that need provider-specific data can still read the raw environment deliberately.

Generated hooks and out-of-repo scripts should use the `skillset-toolkit` CLI because it is shipped by the published `skillset` package. Repo-local tools that already depend on the internal workspace package can import the typed runtime surface directly:

```ts
import { createHookRuntimeContext, renderHookRuntimeContextJson } from "@skillset/toolkit/runtime";

const context = createHookRuntimeContext({
  env: process.env,
  event: "Stop",
  fields: ["provider", "hook.event", "session.id"],
});

process.stdout.write(renderHookRuntimeContextJson(context));
```

Shell hooks can evaluate env output:

```sh
eval "$(skillset-toolkit runtime context --event Stop --format env --fields provider,hook.event,session.id)"
printf '%s\n' "$SKILLSET_PROVIDER:$SKILLSET_HOOK_EVENT"
```

Python hooks can consume JSON output without shell evaluation:

```python
import json
import subprocess

context = json.loads(subprocess.check_output([
    "skillset-toolkit",
    "runtime",
    "context",
    "--event",
    "Stop",
    "--format",
    "json",
]))
print(context["provider"])
```

### Attachments

Hook definitions are reusable. Source units attach named hooks through event-keyed frontmatter or config:

```yaml
hooks:
  PreToolUse:
    - source-change-guard
  Stop:
    - hook: shell-policy
      match:
        tool: [Bash]
      status: Checking shell changes
      providers: [claude, codex]
  auto:
    - session-metadata
```

Plugin-level attachments live in the plugin `skillset.yaml` next to plugin metadata:

```yaml
skillset:
  name: source-guard
hooks:
  PreToolUse:
    - hook: shell-policy
      match: Bash
      status: Checking shell command
      providers: [claude, codex]
```

`hooks.auto` expands from the hook definition's declared events. Attachment-level matchers can narrow a definition but cannot broaden its declared event, matcher, handler, or provider support.

Resolution is nearest-first for named hook references:

1. Skill-local hooks.
2. Agent-local hooks.
3. Plugin-local hooks.
4. Workspace hooks.

Nearest-first resolution only chooses named source definitions. It does not override provider runtime behavior.

### Current Render Support

The implemented render slices support plugin-level command/script hooks, plugin-level `run.env` shell assignments, and Claude frontmatter command hooks. When a plugin attachment resolves to a provider-compatible adaptive hook, Skillset writes provider-native `hooks/hooks.json` into generated provider plugin outputs and declares `hooks` in the plugin manifest. When a Claude skill-local or project-agent-local attachment resolves to a command hook, Skillset writes provider-native `hooks` frontmatter for the generated skill or agent.

Skill-local and project-agent-local attachments currently render only to Claude frontmatter. Plugin-shipped agent frontmatter hooks are not implemented; use a plugin-level hook or provider-native aggregate source until that destination has a faithful render path. Scope Codex-incompatible skill or agent attachments with `providers: [claude]` when the intent is Claude-only. If Codex is enabled and an attachment cannot be faithfully rendered, build/diff/verify surface an `adaptive-hooks` `unsupported:error` render result instead of writing a broader plugin or project hook.

Unsupported cases include Codex skill/agent no-faithful-destination cases, Claude-only plugin events, Codex-ignored plugin matchers, provider overrides, unsupported `run.args`/`run.cwd` fields, frontmatter `run.env` fields, and frontmatter `run.script` path-proof gaps.

### Provider Reference

Use `skillset lookup hooks --events --compat <target>` for provider event, matcher, finite matcher value, handler, and support facts. Use `skillset lookup hooks adaptive --fields --schema --examples` for the adaptive hook unit source contract. Use `skillset lookup hooks toolkit --field context.env --values --compat <target>` for the normalized runtime context field matrix.

Provider details are intentionally registry-backed instead of duplicated here. Claude has the broader hook surface; Codex support is narrower and currently centers on synchronous command handlers. `skillset lookup hooks --events --compat claude,codex` is the preferred way to inspect the current matrix. Skillset keeps provider-specific validation explicit so incompatible hooks fail visibly instead of being silently widened or dropped.

Provider docs checked: 2026-06-25.

- [Claude hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude hooks guide](https://code.claude.com/docs/en/hooks-guide)
- [Codex hooks reference](https://developers.openai.com/codex/hooks)
- [Codex config reference](https://developers.openai.com/codex/config-reference)
- [Codex advanced config](https://developers.openai.com/codex/config-advanced)
- [Codex plugin build docs](https://developers.openai.com/codex/plugins/build)

## Diagnostics

- Reject plugin-root `hooks.json` and hook files that are not JSON objects.
- Validate hook file shape with the shared `@skillset/schema` contract used by Workbench and schema artifacts.
- Validate provider-native hook events and handler types through `packages/core/src/hook-capabilities.ts`.
- Reject unsupported events, missing handler types, and handler types that the selected provider does not run for that event.
- Reject async command handlers for providers that parse but skip them.

## Provenance

Hook definitions are generated plugin files. Plugin lock hashes include hook source content through plugin output hashes; hooks are not activation state.

## Tests and Fixtures

Fixtures cover shared hooks, root hook rejection, target-specific hook validation, async handler rejection, excluded plugin output selection, generated manifest fields, and adaptive hook authoring in `fixtures/adaptive-hooks`, including toolkit runtime context rendering.

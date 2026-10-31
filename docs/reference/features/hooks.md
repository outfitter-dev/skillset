---
description: Skillset hooks define native and adaptive source, events, actions, attachments, provider rendering, and activation limits.
---

# Hooks

<!-- skillset:generated:start feature-support -->
| Feature | Feature status | claude | codex | cursor |
| --- | --- | --- | --- | --- |
| `adaptive-hooks` | `implemented` | `transformed` | `degraded` | `degraded` |
| `future-companion-source-pointers` | `planned` | `planned` | `planned` | `planned` |
| `plugin-hooks` | `implemented` | `pass_through` | `pass_through` | `pass_through` |
| `runtime-context` | `implemented` | `transformed` | `transformed` | `transformed` |
<!-- skillset:generated:end feature-support -->

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

Hooks are [rendered](../../glossary.md#render) definitions only. Skillset never installs, trusts, enables, or mutates user-level Claude, Codex, or Cursor configuration as a side effect of [build](../../glossary.md#build), check, diff, import, init, or create.

Skillset supports two hook source styles:

- Native aggregate hooks preserve [provider-native](../../glossary.md#provider-native) plugin hook files at `hooks/hooks.json`.
- Adaptive hook units are reusable [source units](../../glossary.md#source-unit) under `hooks/<name>.json` or `hooks/<name>/hook.json`. They attach to plugins, skills, or project agents and render only where Skillset can preserve the intended scope.

## Skillset-Owned Project SessionStart

`compile.session_start_hook` controls one advisory project hook, separate from plugin and adaptive hooks. `on` composes `npx skillset hooks run session-start` into `.claude/settings.json` and `.codex/hooks.json`; `off` removes only Skillset's command and its settings-entry lock claim. `auto` enables it only when every enabled project's skill output root is gitignored, including Cursor's skill root when enabled. Cursor has no verified project hook destination, so it receives no SessionStart entry.

Bare `status` does not run Git to decide automatic placement: Git can read configuration and excludes outside the workspace. When this decision is needed, status retains source and release evidence but reports an incomplete output inspection with a nonzero exit. Explicit `on` or `off` avoids this automatic decision. This limitation does not change automatic placement in build or check.

The runner reports stale generated paths, suggests previewing with `npx skillset build` and writing with `npx skillset build --yes`, and points at the `skillset` skill; it never rebuilds, installs, or trusts the hook. The committed SessionStart entry uses `npx` so it resolves for every contributor who checks out the repo, including those without a global install. The `post-tool-use` and `stop` snippets from `skillset hooks print --agent-runtime` stay bare `skillset` because they are reviewed and pasted per environment; set `SKILLSET_HOOK_COMMAND` there when the CLI is not on `PATH`. Skillset identifies its entry by command, leaving other settings keys and hook entries intact. See [Settings](settings.md) for field-level ownership and the old Claude local-settings migration guard.

## Native Aggregate Hooks

The canonical plugin hook source is `<source-root>/plugins/<plugin>/hooks/hooks.json`. The [source root](../../glossary.md#source-root) is `.skillset/`. Plugin-root `hooks.json` is rejected; put hook definitions under `hooks/hooks.json`.

Hook source is JSON with an aggregate `hooks` event map. Event entries may include a `matcher`, `statusMessage`, and a `hooks` array whose handlers declare a non-empty `type` plus handler-specific fields such as `command`, `prompt`, `agent`, `timeout`, and `async`. The active source contract is generated from `@skillset/schema`; see [schema reference](../schemas/README.md) and [hook examples](../examples/hook.yaml) for the current field set.

Use native aggregate source when the hook file is already provider-shaped or intentionally provider-specific. Use adaptive hook units when the hook behavior should attach to a plugin, skill, or project agent and Skillset should render only [destinations](../../glossary.md#destination) that preserve that scope.

`hooks/hooks.json` is a destination-specific native aggregate source. It is not a universal sink for portable hook behavior, and it cannot be combined with adaptive hook units for the same generated plugin hook destination.

Imported provider-native hook files stay native by default. Skillset should only lift native hook material into adaptive hook units when provider capability facts prove the event, matcher, handler, scope, and runtime behavior can be preserved faithfully. Otherwise, native source remains the honest representation.

### Target Rendering

| Source | Claude output | Codex output | Cursor output | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| `hooks/hooks.json` | `hooks/hooks.json` | `hooks/hooks.json` | `hooks/hooks.json` | `target_native` / `implemented` | Destination-specific native aggregate source rendered with a top-level `hooks` object. |
| root `hooks.json` | n/a | n/a | n/a | `unsupported` | Move the file to `hooks/hooks.json`. |
| Future `hooks.source` | n/a | n/a | n/a | `planned` | No feature-key source pointer is implemented. |

The Agent Plugins baseline records plugin hooks as [uncovered](plugins.md#uncovered-components) without blocking supported provider hooks. This does not relax destination-specific validation: unsupported event, matcher or handler mappings still follow their error policy, and a shared hook path does not establish identical behavior across providers.

## Adaptive Hook Units

Adaptive hook units are Skillset-authored source. They let authors define a hook, attach it to its source unit, and render provider-supported event, handler, and scope combinations. These structural checks do not establish equivalent command behavior across providers: authors must account for each host's input, output, environment, and runtime contract.

Adaptive hooks are separate from workflow hook guardrails. Guardrails such as `skillset hooks print` and `skillset hooks run stop` help local Git hooks or reviewed agent-runtime snippets call Skillset checks. Adaptive hooks compile source-authored runtime hook definitions into provider-native hook surfaces.

Plugin hook `status` is presentation text. Claude and Codex output retain it as `statusMessage`; Cursor output omits it while retaining the command. Build, lock, and explain results record that weaker presentation as `degraded` with a `hook-status-omitted` diagnostic at the definition or overriding attachment. The diagnostic does not copy the authored text.

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

Plugin-level adaptive hook rendering copies referenced scripts into the generated plugin root and quotes their runtime paths. Claude and Codex use `$CLAUDE_PLUGIN_ROOT`, which Codex documents as a compatibility alias for its installed plugin root; this keeps their shared hook file identical. Cursor uses its documented `$CURSOR_PLUGIN_ROOT`. These environment contracts are recorded in the provider hook registry from the [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference#where-each-variable-resolves), [Codex plugin hook documentation](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks), and [Cursor hook environment reference](https://cursor.com/docs/hooks#environment-variables). This adaptation applies to source-backed `run.script`; authored `run.command` strings remain unchanged and require their own runtime review.

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
| `toolkit` | Renders through `skillset hooks context`, backed by the shared private `@skillset/toolkit/runtime` context model. |

Inline fields are deliberately small:

| Field | Generated variable |
| --- | --- |
| `provider` | `SKILLSET_PROVIDER` (`claude`, `codex`, or `cursor`) |
| `hook.event` | `SKILLSET_HOOK_EVENT` |
| `session.id` | `SKILLSET_SESSION_ID`, sourced from `${CLAUDE_SESSION_ID:-}`, `${CODEX_SESSION_ID:-}`, or `${CURSOR_SESSION_ID:-}` |

Omitting `context` is equivalent to `context.strategy: none`, so existing hooks keep their command text unchanged.

For `context.strategy: toolkit`, generated hooks call the installed Skillset command:

```sh
skillset hooks context --event <event> --format env --context-fields <field,...>
```

The helper prints shell `export` statements for the requested `SKILLSET_*` values and preserves provider-native environment access for the hook command. It does not erase target-native variables such as `CLAUDE_SESSION_ID`, `CODEX_SESSION_ID`, or `CURSOR_SESSION_ID`; scripts that need provider-specific data can still read the raw environment deliberately. For Cursor hooks, `session.id` resolves in deterministic order from an explicit `SKILLSET_SESSION_ID`, then the JSON stdin `conversation_id`, then `CURSOR_SESSION_ID` as a compatibility fallback. Claude and Codex continue to use their provider session environment variables after an explicit Skillset override.

Generated hooks and out-of-repo scripts should use `skillset hooks context`, the public command shipped by the `skillset` package. Repo-local tools that already depend on the internal [workspace](../../glossary.md#workspace) package can import the typed runtime surface directly:

```ts
import { renderRuntimeContext } from "@skillset/toolkit/runtime";

const output = await renderRuntimeContext({
  env: process.env,
  event: "Stop",
  fields: ["provider", "hook.event", "session.id"],
  format: "json",
});

process.stdout.write(output);
```

Shell hooks can evaluate env output:

```sh
eval "$(skillset hooks context --event Stop --format env --context-fields provider,hook.event,session.id)"
printf '%s\n' "$SKILLSET_PROVIDER:$SKILLSET_HOOK_EVENT"
```

Python hooks can consume JSON output without shell evaluation:

```python
import json
import subprocess

context = json.loads(subprocess.check_output([
    "skillset",
    "hooks",
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

Source `move` and `rename` preview compares resolved adaptive hook identities before and after the planned edits. It rejects a change that would make an attachment select a different definition, including shadowing in an untouched skill or draft. Reconcile hook names and scopes explicitly before retrying. A definition rename with its attachment rewrite and a carried skill-local definition preserve identity. Provider filters do not exempt source bindings from this check. An already unresolved draft can remain untouched by an unrelated edit, but moving it fails until its hook reference is resolved.

### Current Render Support

The implemented render slices support plugin-level command/script hooks, plugin-level `run.env` shell assignments, and Claude frontmatter command hooks. When a plugin attachment resolves to a provider-compatible adaptive hook, Skillset writes provider-native `hooks/hooks.json` into generated provider plugin outputs and declares `hooks` in the plugin manifest. When a Claude skill-local or project-agent-local attachment resolves to a command hook, Skillset writes provider-native `hooks` frontmatter for the generated skill or agent.

Skill-local and project-agent-local attachments currently render only to Claude frontmatter. Plugin-shipped agent frontmatter hooks are not implemented; use a plugin-level hook or provider-native aggregate source until that destination has a faithful render path. Scope Codex- or Cursor-incompatible skill or agent attachments with `providers: [claude]` when the intent is Claude-only. If Codex or Cursor is enabled and an attachment cannot be faithfully rendered, build, diff, and output checks surface an `adaptive-hooks` `unsupported:error` [render result](../../glossary.md#render-result) instead of writing a broader plugin or project hook.

Provider blocks are closed, typed overrides for `events`, `match`, `context`, and `run`. An absent field inherits the portable unit; a supplied field replaces that complete semantic unit; `match: null` and `context: null` clear only those values. An override cannot enable a provider excluded by the unit's `providers` list. Skillset resolves this effective definition once per target before validating attachments, scripts, and target capabilities.

Unsupported cases include Codex and Cursor skill/agent no-faithful-destination cases, Claude-only plugin events, Codex-ignored matchers, `context.includeRaw` until raw-context semantics exist, ambiguous hooks that define both `run.command` and `run.script`, unsupported `run.args`/`run.cwd` fields, frontmatter `run.env` fields, and frontmatter `run.script` path-proof gaps.

### Provider Reference

Use `skillset lookup hooks --events --compat <target>` for provider event, matcher, finite matcher value, handler, and support facts. Use `skillset lookup hooks adaptive --fields --schema --examples` for the adaptive hook unit source contract. Use `skillset lookup hooks toolkit --field context.env --values --compat <target>` for the normalized runtime context field matrix.

Use `skillset new hook <name> --event <event> --command <command> --attach <source-unit>` to preview an attached adaptive hook. Repeat `--event` for a multi-event unit, use `--script <path>` instead of `--command` for schema-supported script actions, and repeat `--provider` only to narrow the registry-derived compatible provider set. Attachment selectors use existing source identities such as `plugin:guard`, `skill:writer`, `plugin.guard.skill:writer`, and `agent:reviewer`; the selected owner determines canonical hook placement and receives a `hooks.auto` attachment. Flat `hooks/<name>.json` is the deterministic default, while a local `./` script reference selects `hooks/<name>/hook.json`. Preview is the default, `--yes` writes both the hook and attachment, collisions fail, and no build runs implicitly.

Bare interactive `skillset new` exposes the same operation: searchable attachment and event choices come from the live source graph and registry, event choices show compatible providers, unsupported attachment destinations show classifier-derived reasons, and explicit flags skip their matching prompts. The final preview and default-No confirmation still come from the shared scaffold report.

Provider details are intentionally registry-backed instead of duplicated here. Claude has the broader hook surface; Codex and Cursor support are narrower and currently center on plugin-level command handlers. Cursor uses provider-native lower-camel event names. `skillset lookup hooks --events --compat claude,codex,cursor` is the preferred way to inspect the current matrix. Skillset keeps provider-specific validation explicit so incompatible hooks fail visibly instead of being silently widened or dropped.

Provider docs checked: 2026-06-25.

- [Claude hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude hooks guide](https://code.claude.com/docs/en/hooks-guide)
- [Codex hooks reference](https://developers.openai.com/codex/hooks)
- [Codex config reference](https://developers.openai.com/codex/config-reference)
- [Codex advanced config](https://developers.openai.com/codex/config-advanced)
- [Codex plugin build docs](https://developers.openai.com/codex/plugins/build)
- [Cursor hooks docs](https://cursor.com/docs/hooks)

## Diagnostics

- Reject plugin-root `hooks.json` and hook files that are not JSON objects.
- Validate hook file shape with the shared `@skillset/schema` contract used by Workbench and schema artifacts.
- Validate provider-native hook events and handler types through `packages/core/src/hook-capabilities.ts`.
- Reject unsupported events, missing handler types, and handler types that the selected provider does not run for that event.
- Reject async command handlers for providers that parse but skip them.

## Provenance

Hook definitions are generated plugin files. Plugin lock hashes include hook source content through plugin output hashes; hooks are not activation state.

## Evidence

Schema, capability, attachment, adapter, and runtime-context tests cover both source models and every generated support claim. Use the generated [hook schema and example](../schemas/README.md), the [Hook Guardrails](../../development/features/hook-guardrails.md) maintainer reference, and [Build Versus Activation](../../start/build-versus-activation.md) for the separate runtime authority boundary.

## Explicit generated-edit guard setup

`skillset hooks setup --target claude --scope project` previews an additive `PreToolUse` command for the installed CLI. Select `--target codex` for local Codex, and `--scope user` for user configuration. Target and scope are required. Add `--yes` to apply the preview, `--policy warn` to select advisory behavior, or `--remove` to preview removal of the recorded hook. The default policy is `block`; the runtime environment can override it with `SKILLSET_GENERATED_EDIT_POLICY=warn`.

Project configuration uses `.claude/settings.local.json` or `.codex/hooks.json` beneath `--root` (the current directory by default). User configuration uses `settings.json` beneath `CLAUDE_CONFIG_DIR` (default `~/.claude`) or `hooks.json` beneath `CODEX_HOME` (default `~/.codex`). Nonempty overrides must be absolute. `--root` is rejected for user scope. The adjacent `<settings-filename>.skillset-generated-edit-hook.json` record binds to that settings filename and owns only the exact installed entry, so rerunning setup after moving a workspace can replace its old executable command. Setup preserves foreign settings value bytes, refuses matching unmanaged or changed owned commands, and writes settings plus ownership in one checked transaction. Removal leaves shared settings and a cleared ownership record in place; it never deletes the configuration file. Keep the record for safe updates and removal.

The preview includes exact paths, entry, policy and provider trust requirements; `--json` returns the same report in the CLI result envelope. Preview performs no writes. Setup neither installs a plugin nor grants trust. Codex requires separate project configuration and hook trust; review the hook in the provider and start a new session. Provider execution has not been qualified by these setup fixtures.

Automatic command generation currently requires a POSIX shell. It captures the running CLI's absolute executable (and script for Bun source execution), safely quotes its arguments, and passes provider stdin through. Rerun setup after relocating, uninstalling or replacing that installation; temporary package-runner locations and versioned Bun paths can expire. Project hooks, including Codex `.codex/hooks.json`, may be tracked and shared, but the configured command is machine-specific. Each checkout must rerun setup for its local CLI; choose user scope to avoid putting local executable paths in project configuration. Setup never ignores or removes an entire shared hook file. No executable download or PATH lookup occurs. Windows automatic setup is rejected until its shell invocation is qualified.

The guard covers documented Claude `Edit`/`Write` and local Codex `apply_patch` events only. Shell edits and unknown protocols are outside its scope. Without an explicit runtime `--root`, it discovers the nearest eligible Skillset workspace from event `cwd`, stopping at repository, home and filesystem boundaries. Missing, stale or ambiguous ownership produces no denial. A successful configuration write is not evidence of provider activation or runtime enforcement.

# Tool Intent

Feature id: `tool-intent`

Support vocabulary: [Feature Reference](README.md#support-vocabulary)

`tool_intent` records portable tool-use intent where possible and keeps provider-native escape hatches explicit. It is intent and metadata unless a target has a documented enforcement or preapproval surface.

## Authoring

Portable `tool_intent.allow` and `tool_intent.deny` accept known keys: `read`, `search`, `write`, `edit`, `shell`, `web_fetch`, `web_search`, and `mcp`. Target-native escapes use `_allow` and `_deny` either under the shared `tool_intent` block with provider keys or directly under `claude.tool_intent` / `codex.tool_intent`. The legacy `tools` key remains a compatibility alias and conflicts if used beside `tool_intent`.

## Target Lowering

| Source | Claude output | Codex output | Status | Notes |
| --- | --- | --- | --- | --- |
| Portable allow/deny intent | `allowed-tools` / `disallowed-tools` preapproval rules | `.skillset.tools.yaml` metadata | `portable` / `metadata_only` | Claude rules reduce prompts; Codex skill-local enforcement is not claimed. |
| Claude `_allow` / `_deny` | native tool rules | n/a | `target_native` / `implemented` | Native strings or rule objects only. |
| Codex `_allow` / `_deny` | n/a | `.skillset.tools.yaml` target-native metadata | `target_native` / `implemented` | Reviewable and locked; not installed into user config. |
| `allowed_tools` | Claude `allowed-tools` | unset or false only | `implemented` / `unsupported` | Codex has no confirmed skill-local allowed-tools equivalent. |

## Diagnostics

- Reject unknown portable tool keys.
- Reject shared or Codex-targeted `allowed_tools` unless Codex is explicitly false.
- Reject target-local portable keys; target blocks accept only `_allow` / `_deny` escape keys.
- Reject malformed Claude native escape rules.
- Fail when both `tool_intent` and `tools` appear at the same level.

## Provenance

Generated Codex `.skillset.tools.yaml` sidecars and lock entries make portable intent and target-native Codex escape metadata reviewable without mutating runtime trust or policy.

## Tests and Fixtures

Fixtures cover portable registry lowering, the `tools` alias, unknown-key failures, target-local escape validation, Codex sidecar metadata, and `allowed_tools` fail-loud behavior.
